package tech.prism;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.*;
import java.util.*;
import java.util.function.Consumer;

/** Thread-confined stage reporting; no credentials, parameters or row values. */
final class ExecutionProgress {
 static final ThreadLocal<ExecutionProgress> LOCAL=new ThreadLocal<>();
 final Consumer<ObjectNode> sink;
 final Map<Connection,ObjectNode> connections=new IdentityHashMap<>();
 ObjectNode scope=Runner.JSON.createObjectNode();String sql="";long lastRows;
 ExecutionProgress(Consumer<ObjectNode> sink){this.sink=sink;}
 static void attach(Consumer<ObjectNode> sink){LOCAL.set(new ExecutionProgress(sink));}
 static void clear(){LOCAL.remove();}
 static void emit(String stage,String message){emit(stage,message,null,-1);}
 static void emit(String stage,String message,String sql,long rows){ExecutionProgress p=LOCAL.get();if(p==null)return;if(sql!=null)p.sql=sql;ObjectNode event=p.scope.deepCopy().put("stage",stage).put("message",message);if(!p.sql.isBlank())event.put("sql",p.sql.length()>2000?p.sql.substring(0,2000)+"\n… SQL 已截断":p.sql);if(rows>=0)event.put("rows",Long.toString(rows));p.sink.accept(event);}
 static void local(String stage,String message){ExecutionProgress p=LOCAL.get();if(p!=null){p.scope=Runner.JSON.createObjectNode();p.sql="";}emit(stage,message);}
 static void use(Connection c){ExecutionProgress p=LOCAL.get();if(p!=null){p.scope=p.connections.getOrDefault(c,Runner.JSON.createObjectNode());p.sql="";}}
 static Connection connect(JsonNode source,String side)throws Exception{ExecutionProgress p=LOCAL.get();if(p!=null){p.scope=Runner.JSON.createObjectNode().put("side",side).put("sourceId",source.path("id").asText()).put("sourceName",source.path("name").asText());p.sql="";}emit("connecting","正在建立 JDBC 连接");Connection c=Engine.connect(source);if(p!=null)p.connections.put(c,p.scope);emit("connected","JDBC 连接已建立");return c;}
 static ResultSet query(PreparedStatement st)throws SQLException{emit("querying","正在执行 SQL，等待数据库返回");ResultSet rs=st.executeQuery();emit("reading","数据库已返回结果，正在读取",null,0);return rs;}
 static void rows(String stage,String message,long count,boolean force){ExecutionProgress p=LOCAL.get();if(p==null)return;long now=System.nanoTime();if(force||now-p.lastRows>=1_000_000_000L){p.lastRows=now;emit(stage,message,null,count);}}
}
