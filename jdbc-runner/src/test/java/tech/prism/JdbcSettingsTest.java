package tech.prism;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.lang.reflect.*;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class JdbcSettingsTest {
  ObjectNode source(String type,String url,String catalog,String schema){return Runner.JSON.createObjectNode().put("type",type).put("jdbcUrl",url).put("catalog",catalog).put("schema",schema).put("username","test-reader").put("password","test-only-secret");}

  @Test void bareMaxComputeEndpointUsesSeparateProjectAndAllowsNoSchema(){
    var c=JdbcSettings.from(source("maxcompute","jdbc:odps:https://service.example/api","analytics",""));
    assertEquals("analytics",c.properties().getProperty("project_name"));
    assertFalse(c.properties().containsKey("schema"));
    assertFalse(c.url().contains("test-only-secret"));
  }
  @Test void projectInUrlAlsoWorksAndMissingOrConflictingProjectsFailBeforeNetwork(){
    var s=source("maxcompute","jdbc:odps:https://service.example/api?project=analytics","","");
    assertEquals("analytics",JdbcSettings.from(s).properties().getProperty("project_name"));
    s.put("catalog","different");assertTrue(assertThrows(IllegalArgumentException.class,()->JdbcSettings.from(s)).getMessage().contains("不一致"));
    s.put("catalog","").put("jdbcUrl","jdbc:odps:https://service.example/api");
    assertTrue(assertThrows(IllegalArgumentException.class,()->JdbcSettings.from(s)).getMessage().contains("缺少 MaxCompute 项目名"));
  }
  @Test void lakehouseApiEndpointUsesWorkspaceFieldAndKeepsGatewayPath(){
    var c=JdbcSettings.from(source("lakehouse","jdbc:clickzetta://instance.lakehouse-studio.corp.example/api","analytics",""));
    assertEquals("jdbc:clickzetta://instance.lakehouse-studio.corp.example/api/analytics",c.url());
    assertFalse(c.url().contains("test-only-secret"));
  }
  @Test void lakehousePreservesExplicitWorkspaceAndUrlSchema(){
    var c=JdbcSettings.from(source("lakehouse","jdbc:clickzetta://instance.api.example/api/analytics?virtualCluster=vc&schema=public","analytics","old_default"));
    assertTrue(c.url().endsWith("virtualCluster=vc&schema=public"));
    assertFalse(c.url().contains("old_default"));
    assertThrows(IllegalArgumentException.class,()->JdbcSettings.from(source("lakehouse",c.url(),"other","")));
  }
  @Test void lakehouseBareHostTrailingSlashAndSchemaFallback(){
    var c=JdbcSettings.from(source("lakehouse","jdbc:clickzetta://my_instance.private.example:8443/?virtualCluster=vc","analytics","public"));
    assertEquals("jdbc:clickzetta://my_instance.private.example:8443/analytics?virtualCluster=vc&schema=public",c.url());
    var api=JdbcSettings.from(source("lakehouse","jdbc:clickzetta://instance.private.example/api/","analytics",""));
    assertTrue(api.url().endsWith("/api/analytics"));
    assertThrows(IllegalArgumentException.class,()->JdbcSettings.from(source("lakehouse","jdbc:clickzetta://instance.private.example/api","","")));
  }
  @Test void mysqlSettingsRemainUsable(){
    var c=JdbcSettings.from(source("mysql","jdbc:mysql://localhost/db","db",""));
    assertEquals("jdbc:mysql://localhost/db",c.url());assertEquals("true",c.properties().getProperty("useCursorFetch"));
  }
  @Test void jsonResponseFailureExplainsStageWithoutClaimingCause(){
    Exception original=new SQLException("Expected BEGIN_OBJECT but was STRING at line 1 column 1 path $ password=test-only-secret");
    var failure=Runner.connectionFailure(source("lakehouse","","",""),original,"建立 JDBC 连接");
    assertTrue(failure.getMessage().contains("建立 JDBC 连接"));
    assertTrue(failure.getMessage().contains("无法确认具体原因"));
    assertFalse(failure.getMessage().contains("test-only-secret"));
    assertSame(original,Runner.connectionFailure(source("mysql","","",""),original,"建立 JDBC 连接"));
  }

  // These two tests use the actual shipped vendor parsers, without opening a connection.
  // Source-only / Docker builds may omit drivers; the full migration package includes them.
  URLClassLoader vendor(String filename)throws Exception{
    Path jar=Path.of("drivers",filename);assumeTrue(Files.isRegularFile(jar),"optional vendor JAR is not installed");
    // Match start-runner's drivers/* classpath, including shared driver dependencies.
    try(var files=Files.list(jar.getParent())){
      URL[] urls=files.filter(p->p.toString().endsWith(".jar")).sorted().map(p->{try{return p.toUri().toURL();}catch(Exception e){throw new IllegalStateException(e);}}).toArray(URL[]::new);
      return new URLClassLoader(urls,getClass().getClassLoader());
    }
  }
  @Test void shippedOdpsParserReceivesTheSeparateProjectAndOptionalSchema()throws Exception{
    try(var loader=vendor("odps-jdbc-3.8.6-jar-with-dependencies.jar")){
      Class<?> resource=loader.loadClass("com.aliyun.odps.jdbc.utils.ConnectionResource");
      for(String schema:List.of("","business")){
        var config=JdbcSettings.from(source("maxcompute","jdbc:odps:https://service.example/api","analytics",schema));
        Object parsed=resource.getConstructor(String.class,Properties.class).newInstance(config.url(),config.properties());
        assertEquals("analytics",resource.getMethod("getProject").invoke(parsed));
        if(!schema.isBlank())assertEquals(schema,resource.getMethod("getSchema").invoke(parsed));
      }
    }
  }
  @Test void oldDefaultSchemaDoesNotEnableThreeTierModeInRealDriver()throws Exception{
    try(var loader=vendor("odps-jdbc-3.8.6-jar-with-dependencies.jar")){
      Class<?> resource=loader.loadClass("com.aliyun.odps.jdbc.utils.ConnectionResource");
      for(String schema:List.of("","default")){
        var config=JdbcSettings.from(source("maxcompute","jdbc:odps:https://service.example/api","analytics",schema));
        Object parsed=resource.getConstructor(String.class,Properties.class).newInstance(config.url(),config.properties());
        assertEquals(false,resource.getMethod("isOdpsNamespaceSchema").invoke(parsed));
        assertNull(resource.getMethod("getSchema").invoke(parsed));
      }
      var explicit=JdbcSettings.from(source("maxcompute","jdbc:odps:https://service.example/api?odpsNamespaceSchema=true","analytics","default"));
      Object parsed=resource.getConstructor(String.class,Properties.class).newInstance(explicit.url(),explicit.properties());
      assertEquals(true,resource.getMethod("isOdpsNamespaceSchema").invoke(parsed));
      assertEquals("default",resource.getMethod("getSchema").invoke(parsed));
      assertThrows(IllegalArgumentException.class,()->JdbcSettings.from(source("maxcompute","jdbc:odps:https://service.example/api?odpsNamespaceSchema=false&schema=default","analytics","")));
    }
  }
  @Test void virtualClusterFieldReachesActualLakehouseDriver()throws Exception{
    try(var loader=vendor("clickzetta-jdbc-4.0.0.jar")){
      var input=source("lakehouse","jdbc:clickzetta://instance.corp.example/api","analytics","");
      input.putObject("properties").put("virtualCluster","analytics_compute");
      var config=JdbcSettings.from(input);
      Class<?> context=loader.loadClass("com.clickzetta.client.jdbc.core.CZConnectContext");
      Object parsed=context.getMethod("parse",String.class,Properties.class).invoke(null,config.url(),config.properties());
      Method method=context.getDeclaredMethod("getVirtualCluster");method.setAccessible(true);
      assertEquals("analytics_compute",method.invoke(parsed));
      input.put("jdbcUrl","jdbc:clickzetta://instance.corp.example/api?virtualCluster=other");
      assertThrows(IllegalArgumentException.class,()->JdbcSettings.from(input));
      input.put("jdbcUrl","jdbc:clickzetta://instance.corp.example/api?vcluster=analytics_compute");
      assertFalse(JdbcSettings.from(input).url().contains("virtualCluster="));
    }
  }
  @Test void shippedClickZettaParserRecognizesApiWorkspaceAndSeparateCredentials()throws Exception{
    try(var loader=vendor("clickzetta-jdbc-4.0.0.jar")){
      Class<?> context=loader.loadClass("com.clickzetta.client.jdbc.core.CZConnectContext");
      var config=JdbcSettings.from(source("lakehouse","jdbc:clickzetta://instance.lakehouse-studio.corp.example/api?virtualCluster=compute","analytics","public"));
      Object parsed=context.getMethod("parse",String.class,Properties.class).invoke(null,config.url(),config.properties());
      for(var expected:Map.of("getWorkspace","analytics","getSchema","public","getVirtualCluster","compute","getUserName","test-reader","getEndpoint","lakehouse-studio.corp.example/api").entrySet()){
        Method method=context.getDeclaredMethod(expected.getKey());method.setAccessible(true);
        assertEquals(expected.getValue(),method.invoke(parsed),expected.getKey());
      }
    }
  }
  public interface OdpsNamespace {boolean isOdpsNamespaceSchema();}
  Connection connection(boolean enabled,String project,String schema){
    return (Connection)Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{Connection.class,OdpsNamespace.class},(proxy,method,args)->switch(method.getName()){
      case "isOdpsNamespaceSchema" -> enabled;
      case "getCatalog" -> enabled?project:null;
      case "getSchema" -> enabled?schema:project;
      default -> throw new UnsupportedOperationException(method.getName());
    });
  }
  @Test void legacyMaxComputeMetadataProjectIsNotMistakenForAnEnabledSchema()throws Exception{
    var s=source("maxcompute","","analytics","");var c=connection(false,"analytics","");
    assertEquals("`analytics`.`orders`",Engine.qualified(c,s,"analytics","orders"));
    assertEquals("`analytics`.`orders`",Engine.qualified(c,s,"","orders"));
    s.put("catalog","");assertEquals("`analytics`.`orders`",Engine.qualified(c,s,"analytics","orders"));
    assertThrows(IllegalArgumentException.class,()->Engine.qualified(c,s,"unrelated","orders"));
  }
  @Test void schemaEnabledMaxComputeUsesConnectionDefaultSchema()throws Exception{
    assertEquals("`analytics`.`business`.`orders`",Engine.qualified(connection(true,"analytics","business"),source("maxcompute","","",""),"","orders"));
  }
  Connection catalogConnection(boolean enabled,String project,String schema)throws Exception{
    Connection namespace=connection(enabled,project,schema);
    DatabaseMetaData metadata=(DatabaseMetaData)Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{DatabaseMetaData.class},(proxy,method,args)->{
      if(!method.getName().equals("getTables"))throw new UnsupportedOperationException(method.getName());
      assertEquals(project,args[0]);assertNull(args[1]);assertEquals("%",args[2]);
      var rows=javax.sql.rowset.RowSetProvider.newFactory().createCachedRowSet();
      var description=new javax.sql.rowset.RowSetMetaDataImpl();description.setColumnCount(3);
      for(int i=1;i<=3;i++){description.setColumnName(i,List.of("TABLE_NAME","TABLE_SCHEM","TABLE_CAT").get(i-1));description.setColumnType(i,Types.VARCHAR);}
      rows.setMetaData(description);rows.moveToInsertRow();rows.updateString(1,"orders");rows.updateString(2,enabled?schema:project);rows.updateString(3,enabled?project:"");rows.insertRow();rows.moveToCurrentRow();rows.beforeFirst();return rows;
    });
    return (Connection)Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{Connection.class,OdpsNamespace.class},(proxy,method,args)->{
      if(method.getName().equals("getMetaData"))return metadata;
      try{return method.invoke(namespace,args);}catch(InvocationTargetException e){throw e.getCause();}
    });
  }
  @Test void catalogReportsActualMaxComputeNamespaceModeIncludingSchemaNamedLikeProject()throws Exception{
    for(boolean enabled:List.of(false,true))for(String configuredProject:List.of("","new_project")){
      // Both modes can expose the same TABLE_SCHEM text; only the connection mode distinguishes them.
      ObjectNode result=Engine.catalog(catalogConnection(enabled,"new_project","new_project"),source("maxcompute","",configuredProject,""));
      assertEquals(enabled?"schema":"project",result.path("namespaceMode").asText());
      assertEquals("new_project",result.path("project").asText());assertTrue(result.path("schemas").isArray());
      assertEquals(1,result.path("tables").size());assertEquals("orders",result.path("tables").get(0).path("name").asText());
      assertEquals("new_project",result.path("tables").get(0).path("schema").asText());
    }
  }
  @Test void staleTwoTierMappingIsRejectedBeforeReadingMetadata(){
    // This connection throws for getMetaData: the mapping guard must reject first.
    var error=assertThrows(IllegalArgumentException.class,()->Engine.columns(connection(false,"new_project",""),source("maxcompute","","new_project",""),"old_project","orders"));
    assertTrue(error.getMessage().contains("old_project"));assertTrue(error.getMessage().contains("new_project"));
    assertTrue(error.getMessage().contains("保存测试计划"));assertFalse(error.getMessage().contains("启用 schema"));
  }
  @Test void namespaceValidationFailureIsAttributedToItsConnectionInsteadOfLastConnectedSide(){
    Connection baseline=connection(false,"new_project","");List<ObjectNode> events=new ArrayList<>();ExecutionProgress.attach(events::add);
    try{
      ExecutionProgress progress=ExecutionProgress.LOCAL.get();progress.connections.put(baseline,Runner.JSON.createObjectNode().put("side","baseline").put("sourceId","mc"));
      progress.scope=Runner.JSON.createObjectNode().put("side","target").put("sourceId","lakehouse");progress.sql="SELECT target_query";
      Exception failure=assertThrows(IllegalArgumentException.class,()->Engine.qualified(baseline,source("maxcompute","","new_project",""),"old_project","orders"));
      ExecutionProgress.emit("error",failure.getMessage());
      assertEquals("baseline",events.get(0).path("side").asText());assertEquals("mc",events.get(0).path("sourceId").asText());assertFalse(events.get(0).has("sql"));
    }finally{ExecutionProgress.clear();}
  }
  @Test void sqlCompilationFailureIsAttributedBeforeAnyStatementIsPrepared(){
    Connection target=connection(false,"target_project","");List<ObjectNode> events=new ArrayList<>();ExecutionProgress.attach(events::add);
    try{
      ExecutionProgress progress=ExecutionProgress.LOCAL.get();progress.connections.put(target,Runner.JSON.createObjectNode().put("side","target").put("sourceId","target-mc"));
      progress.scope=Runner.JSON.createObjectNode().put("side","baseline");
      Exception failure=assertThrows(IllegalArgumentException.class,()->Engine.compileSql("SELECT ${missing} FROM ${table}",Runner.JSON.createObjectNode(),target,source("maxcompute","","target_project",""),"target_project","orders",100));
      assertTrue(failure.getMessage().contains("未定义变量"));ExecutionProgress.emit("error",failure.getMessage());
      assertEquals("target",events.get(0).path("side").asText());assertEquals("target-mc",events.get(0).path("sourceId").asText());
    }finally{ExecutionProgress.clear();}
  }
}
