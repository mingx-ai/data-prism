package tech.prism;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import com.sun.net.httpserver.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.io.*;

/** Private JDBC execution gateway. Bind locally or place behind authenticated TLS ingress. */
public final class Runner {
  static final ObjectMapper JSON=new ObjectMapper();
  static final Map<String,Job> JOBS=new ConcurrentHashMap<>();
  static final ThreadPoolExecutor EXEC=(ThreadPoolExecutor)Executors.newFixedThreadPool(2);
  static Path data;
  static String token;
  public static void main(String[] args)throws Exception{
    token=System.getenv("JDBC_GATEWAY_TOKEN");if(token==null||token.length()<32)throw new IllegalArgumentException("JDBC_GATEWAY_TOKEN must contain at least 32 characters");
    data=Path.of(System.getenv().getOrDefault("PRISM_DATA_DIR","data")).toAbsolutePath();Files.createDirectories(data);
    try(var files=Files.list(data)){for(Path file:files.filter(p->p.getFileName().toString().endsWith(".json")).toList()){ObjectNode run=(ObjectNode)JSON.readTree(file.toFile());String status=run.path("status").asText();if(Set.of("queued","running","pausing","paused","cancelling").contains(status)){run.put("status","failed");run.put("error","JDBC 执行服务重启中断了任务，请使用原计划重新执行。");}Job job=new Job(run,null);JOBS.put(run.path("id").asText(),job);job.persist();}}
    HttpServer server=HttpServer.create(new InetSocketAddress(System.getenv().getOrDefault("PRISM_BIND","127.0.0.1"),Integer.parseInt(System.getenv().getOrDefault("PRISM_PORT","8081"))),32);
    server.createContext("/",Runner::handle);server.setExecutor(Executors.newFixedThreadPool(12));server.start();System.out.println("Prism JDBC runner listening on "+server.getAddress());
  }
  static void handle(HttpExchange x)throws IOException{
    try{
      String auth=x.getRequestHeaders().getFirst("Authorization");if(auth==null||!MessageDigest.isEqual(auth.getBytes(StandardCharsets.UTF_8),("Bearer "+token).getBytes(StandardCharsets.UTF_8))){reply(x,401,Map.of("error","Unauthorized"));return;}
      String path=x.getRequestURI().getPath(),method=x.getRequestMethod();JsonNode body=JSON.createObjectNode();if(method.equals("POST")){byte[] bytes=x.getRequestBody().readNBytes(4*1024*1024+1);if(bytes.length>4*1024*1024)throw new IllegalArgumentException("请求过大");body=JSON.readTree(bytes);}
      if(path.equals("/health")&&method.equals("GET")){reply(x,200,Map.of("ok",true,"version","1.0.0"));return;}
      if(path.equals("/test")&&method.equals("POST")){reply(x,200,testConnection(body));return;}
      if(path.equals("/columns")&&method.equals("POST")){reply(x,200,Engine.describeTable(body));return;}
      if(path.equals("/catalog")&&method.equals("POST")){reply(x,200,Engine.catalog(body));return;}
      if(path.equals("/runs")&&method.equals("POST")){ObjectNode run=(ObjectNode)body.path("run").deepCopy();String id=run.path("id").asText();UUID.fromString(id);if(JOBS.containsKey(id)){reply(x,200,JOBS.get(id).snapshot());return;}Job job=new Job(run,body.path("sources"));JOBS.put(id,job);job.persist();EXEC.submit(job::execute);reply(x,200,job.snapshot());return;}
      String[] parts=path.split("/");if(parts.length>=3&&parts[1].equals("runs")){Job job=JOBS.get(parts[2]);if(job==null){reply(x,404,Map.of("error","执行记录不存在"));return;}if(method.equals("GET")&&parts.length==4&&parts[3].equals("audit")){
          Map<String,String> query=new HashMap<>();for(String pair:Objects.toString(x.getRequestURI().getRawQuery(),"").split("&")){String[] kv=pair.split("=",2);if(kv.length==2)query.put(URLDecoder.decode(kv[0],StandardCharsets.UTF_8),URLDecoder.decode(kv[1],StandardCharsets.UTF_8));}
          String resultId=query.getOrDefault("resultId","");ObjectNode snapshot=job.snapshot();JsonNode result=null;for(JsonNode item:snapshot.path("results"))if(item.path("id").asText().equals(resultId)){result=item;break;}if(result==null)throw new IllegalArgumentException("校验结果尚未生成或不存在");
          Path auditFile=auditPath(parts[2],resultId);if(!Files.exists(auditFile))throw new IllegalArgumentException("此历史记录没有完整忽略差异审计文件，请重新执行以生成明细");
          if(query.getOrDefault("download","").equals("1")){x.getResponseHeaders().set("Content-Type","application/x-ndjson; charset=utf-8");x.getResponseHeaders().set("Content-Disposition","attachment; filename=ignored-"+parts[2]+"-"+resultId.replace(':','-')+".ndjson");x.sendResponseHeaders(200,0);Files.copy(auditFile,x.getResponseBody());return;}
          int page=Math.max(1,Integer.parseInt(query.getOrDefault("page","1"))),size=Math.min(100,Math.max(1,Integer.parseInt(query.getOrDefault("pageSize","20"))));ArrayNode items=JSON.createArrayNode();long skip=(long)(page-1)*size;
          try(BufferedReader reader=Files.newBufferedReader(auditFile)){String line;long n=0;while((line=reader.readLine())!=null){if(n++<skip)continue;items.add(JSON.readTree(line));if(items.size()>=size)break;}}
          ObjectNode output=JSON.createObjectNode().put("total",result.path("ignoredCount").asLong()).put("page",page).put("pageSize",size).put("complete",true);output.set("items",items);reply(x,200,output);return;
        }if(method.equals("GET")){reply(x,200,job.snapshot());return;}if(method.equals("DELETE")){synchronized(job){if(!job.terminal())throw new IllegalArgumentException("请先取消执行，再删除记录");job.deleted=true;Path audits=data.resolve("audit").resolve(parts[2]);if(Files.exists(audits))try(var files=Files.walk(audits)){for(Path file:files.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(file);}Files.deleteIfExists(data.resolve(parts[2]+".json"));JOBS.remove(parts[2]);}reply(x,200,Map.of("ok",true));return;}if(method.equals("POST")&&parts.length==4){job.control(parts[3]);reply(x,200,job.snapshot());return;}}
      reply(x,404,Map.of("error","接口不存在"));
    }catch(Exception e){reply(x,400,Map.of("error",safeError(e)));}finally{x.close();}
  }
  static Map<String,Object> testConnection(JsonNode source)throws Exception{
    String phase="建立 JDBC 连接";
    try(Connection c=Engine.connect(source)){
      phase="执行 SELECT 1";
      try(Statement s=c.createStatement()){s.setQueryTimeout(30);try(ResultSet rs=s.executeQuery("SELECT 1")){if(!rs.next())throw new SQLException("SELECT 1 未返回数据");return Map.of("ok",true,"product",c.getMetaData().getDatabaseProductName(),"driver",c.getMetaData().getDriverName());}}
    }catch(Exception error){throw connectionFailure(source,error,phase);}
  }
  static Exception connectionFailure(JsonNode source,Exception error,String phase){
    if(source.path("type").asText().equals("lakehouse")){
      for(Throwable cause=error;cause!=null;cause=cause.getCause()){
        if(cause.getClass().getName().endsWith("JsonSyntaxException")||Objects.toString(cause.getMessage(),"").contains("Expected BEGIN_OBJECT"))return new SQLException("云器在「"+phase+"」阶段收到无法按预期 JSON 对象解析的响应。请核对控制台 JDBC 服务地址、/api/Workspace 路径，以及公司代理或网关的响应；仅凭此异常无法确认具体原因。原始错误："+safeError(error),error);
      }
    }
    return error;
  }
  static String safeError(Exception e){String msg=e.getMessage();return msg==null?e.getClass().getSimpleName():msg.replaceAll("(?i)(password|accessKey|access_key|secret|token)=([^&\\s;]+)","$1=***");}
  static void reply(HttpExchange x,int status,Object value)throws IOException{byte[] bytes=JSON.writeValueAsBytes(value);x.getResponseHeaders().set("Content-Type","application/json; charset=utf-8");x.getResponseHeaders().set("Cache-Control","no-store");x.sendResponseHeaders(status,bytes.length);x.getResponseBody().write(bytes);}
  static Path auditPath(String runId,String resultId){if(!runId.matches("[A-Za-z0-9_-]+")||!resultId.matches("[A-Za-z0-9_-]+:(schema|count|data)"))throw new IllegalArgumentException("执行或结果编号格式无效");return data.resolve("audit").resolve(runId).resolve(resultId.replace(':','_')+".ndjson");}
  static String now(){return Instant.now().toString();}
  static final class Job{
    final ObjectNode run;JsonNode sources;volatile boolean pause,cancel,deleted;volatile Thread worker;
    ObjectNode context=JSON.createObjectNode();long lastProgressPersist;
    Job(ObjectNode run,JsonNode sources){this.run=run;this.sources=sources;if(sources!=null)progress(JSON.createObjectNode().put("stage","queued").put("message","任务已接收，等待 JDBC 执行线程（最多同时执行 2 个任务）"));}
    synchronized ObjectNode snapshot(){ObjectNode copy=run.deepCopy();copy.put("gatewayObservedAt",now());copy.putObject("executor").put("active",EXEC.getActiveCount()).put("queued",EXEC.getQueue().size()).put("capacity",EXEC.getMaximumPoolSize());return copy;}
    synchronized void progress(ObjectNode detail){
      String at=now();ObjectNode event=context.deepCopy();event.setAll(detail);event.put("at",at);
      JsonNode previous=run.path("progress");boolean same=true;for(String key:List.of("groupId","mappingId","dimension","stage","side","sql"))if(!previous.path(key).equals(event.path(key)))same=false;
      event.put("startedAt",same?previous.path("startedAt").asText(at):at);run.set("progress",event);run.put("updatedAt",at);
      ArrayNode events=run.withArray("progressEvents");if(same&&!events.isEmpty()&&!events.get(events.size()-1).path("stage").asText().equals("control"))events.set(events.size()-1,event.deepCopy());else{events.add(event.deepCopy());if(events.size()>200)events.remove(0);}
      long now=System.currentTimeMillis();if(!same||now-lastProgressPersist>=2000){try{persist();lastProgressPersist=now;}catch(IOException e){throw new UncheckedIOException(e);}}
    }
    synchronized void controlEvent(String message){ObjectNode event=context.deepCopy().put("stage","control").put("message",message).put("at",now()).put("startedAt",now());ArrayNode events=run.withArray("progressEvents");events.add(event);if(events.size()>200)events.remove(0);}

    synchronized boolean terminal(){return Set.of("completed","failed","cancelled").contains(run.path("status").asText());}
    synchronized void persist()throws IOException{if(deleted)return;run.put("updatedAt",now());Path file=data.resolve(run.path("id").asText()+".json"),tmp=data.resolve(run.path("id").asText()+".tmp");JSON.writeValue(tmp.toFile(),run);try{Files.move(tmp,file,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}catch(AtomicMoveNotSupportedException e){Files.move(tmp,file,StandardCopyOption.REPLACE_EXISTING);}}
    synchronized void control(String action)throws Exception{String status=run.path("status").asText();switch(action){case "pause" -> {if(!Set.of("running","queued").contains(status))throw new IllegalArgumentException("当前任务不可暂停");pause=true;run.put("status",worker==null?"paused":"pausing");if(worker==null)progress(JSON.createObjectNode().put("stage","paused").put("message","任务在排队期间已暂停"));}case "resume" -> {if(!status.equals("paused"))throw new IllegalArgumentException("当前任务不可恢复");if(sources==null)throw new IllegalArgumentException("执行上下文已释放，请重新执行计划");pause=false;run.put("status",worker==null?"queued":"running");if(worker==null)progress(JSON.createObjectNode().put("stage","queued").put("message","等待 JDBC 执行线程"));notifyAll();}case "cancel" -> {if(terminal())throw new IllegalArgumentException("任务已经结束");cancel=true;pause=false;if(worker==null){run.put("status","cancelled");run.put("finishedAt",now());progress(JSON.createObjectNode().put("stage","cancelled").put("message","排队任务已取消"));}else run.put("status","cancelling");notifyAll();}default -> throw new IllegalArgumentException("操作不存在");}controlEvent(action.equals("pause")?"已请求暂停；当前表结束后暂停":action.equals("resume")?"已请求继续执行":"已请求取消；等待当前 JDBC 调用返回");persist();}
    void execute(){worker=Thread.currentThread();try{ObjectNode plan=(ObjectNode)run.path("snapshot");Map<String,JsonNode> byId=new HashMap<>();for(JsonNode s:sources)byId.put(s.path("id").asText(),s);
      for(JsonNode group:plan.path("groups")){for(JsonNode m:group.path("mappings")){if(m.path("frozen").asBoolean())continue;
        synchronized(this){while(pause&&!cancel){run.put("status","paused");progress(JSON.createObjectNode().put("stage","paused").put("message","执行已暂停，等待继续"));persist();wait();}if(cancel)break;run.put("status","running");run.put("currentTable",m.path("baselineTable").asText());persist();}
        JsonNode strategy=Engine.effectiveStrategy(plan,m,m.path("strategy"));
        for(JsonNode dim:strategy.path("dimensions")){if(cancel)break;ObjectNode result;
          synchronized(this){context=JSON.createObjectNode().put("groupId",group.path("id").asText()).put("mappingId",m.path("id").asText()).put("dimension",dim.asText());for(String k:List.of("baselineTable","baselineSchema","targetTable","targetSchema"))context.set(k,m.path(k));}
          progress(JSON.createObjectNode().put("stage","starting").put("message","开始校验，准备审计文件"));
          ExecutionProgress.attach(this::progress);
          Path auditFile=auditPath(run.path("id").asText(),m.path("id").asText()+":"+dim.asText());Files.createDirectories(auditFile.getParent());
          try(BufferedWriter writer=Files.newBufferedWriter(auditFile,StandardCharsets.UTF_8)){
            Engine.AUDIT.set(entry->{ObjectNode audit=entry.deepCopy();audit.put("runId",run.path("id").asText()).put("planId",run.path("planId").asText()).put("resultId",m.path("id").asText()+":"+dim.asText()).put("dimension",dim.asText()).put("recordedAt",now());ObjectNode baseline=audit.putObject("baselineContext");baseline.put("sourceId",group.path("baselineId").asText()).put("schema",m.path("baselineSchema").asText()).put("table",m.path("baselineTable").asText());ObjectNode target=audit.putObject("targetContext");target.put("sourceId",group.path("targetId").asText()).put("schema",m.path("targetSchema").asText()).put("table",m.path("targetTable").asText());writer.write(audit.toString());writer.newLine();});
            result=Engine.compare(plan,group,m,strategy,dim.asText(),byId.get(group.path("baselineId").asText()),byId.get(group.path("targetId").asText()),()->cancel);
          }finally{Engine.AUDIT.remove();ExecutionProgress.clear();}
          synchronized(this){progress(JSON.createObjectNode().put("stage",result.path("status").asText().equals("error")?"dimension_error":"dimension_complete").put("message",result.path("summary").asText()));((ArrayNode)run.withArray("results")).add(result);persist();}}
        synchronized(this){if(!cancel)run.put("completedTables",run.path("completedTables").asInt()+1);persist();}
      }if(cancel)break;}
      synchronized(this){run.put("status",cancel?"cancelled":"completed");run.put("finishedAt",now());run.remove("currentTable");context=JSON.createObjectNode();progress(JSON.createObjectNode().put("stage",cancel?"cancelled":"completed").put("message",cancel?"执行已取消":"全部表执行已结束"));persist();}
    }catch(Exception e){synchronized(this){run.put("status","failed");run.put("error",safeError(e));run.put("finishedAt",now());try{progress(JSON.createObjectNode().put("stage","failed").put("message",safeError(e)));persist();}catch(Exception ignored){}}}finally{ExecutionProgress.clear();sources=null;worker=null;}}
  }
}
