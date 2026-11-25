package tech.prism;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import java.sql.*;
import java.util.*;
import java.nio.file.*;
class EngineTest{
 ObjectMapper j=Runner.JSON;ObjectNode plan,group,mapping,strategy,a,b;String url;
 @BeforeEach void setup()throws Exception{System.setProperty("prism.test","true");url="jdbc:h2:mem:"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";try(Connection c=DriverManager.getConnection(url,"sa","");Statement s=c.createStatement()){s.execute("CREATE SCHEMA baseline");s.execute("CREATE SCHEMA target");for(String schema:List.of("baseline","target")){s.execute("CREATE TABLE "+schema+".orders(id BIGINT PRIMARY KEY, amount DECIMAL(20,6), note VARCHAR(50), dt VARCHAR(30))");s.execute("INSERT INTO "+schema+".orders VALUES(9007199254740993,100.123456,'ok','2026-09-04'),(2,20.10,NULL,'2026-09-04'),(3,30.00,'later','2026-09-05')");}}
 a=j.createObjectNode().put("id","a").put("name","baseline").put("type","h2").put("jdbcUrl",url).put("username","sa").put("password","");b=a.deepCopy().put("id","b").put("name","target");
 strategy=(ObjectNode)j.readTree("{\"dimensions\":[\"schema\",\"count\",\"data\"],\"mode\":\"sample\",\"limit\":\"100\",\"ignorePrecision\":false,\"tolerance\":\"0\",\"ignoredValues\":[],\"filter\":\"\",\"fallbackFilter\":\"\",\"order\":\"id ASC\",\"fallbackOrder\":\"order_id,user_id\",\"key\":\"id\",\"sql\":{\"schema\":{},\"count\":{},\"data\":{}}}");plan=j.createObjectNode();plan.putArray("variables").addObject().put("name","biz_date").put("value","2026-09-04").put("type","string");plan.set("strategy",strategy);group=j.createObjectNode().put("id","g").put("baselineId","a").put("targetId","b");mapping=j.createObjectNode().put("id","m").put("baselineTable","orders").put("baselineSchema","baseline").put("targetTable","orders").put("targetSchema","target").put("override",true);mapping.set("strategy",strategy);group.putArray("mappings").add(mapping);plan.putArray("groups").add(group);
 }
 void sql(String sql)throws Exception{try(Connection c=DriverManager.getConnection(url,"sa","");Statement st=c.createStatement()){st.execute(sql);}}
 Connection metadataFailure(Connection actual,String unsupported,SQLException failure){
   DatabaseMetaData metadata=(DatabaseMetaData)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{DatabaseMetaData.class},(proxy,method,args)->{
     if(method.getName().equals(unsupported))throw failure;
     try{return method.invoke(actual.getMetaData(),args);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
   });
   return (Connection)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
     if(method.getName().equals("getMetaData"))return metadata;
     try{return method.invoke(actual,args);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
   });
 }
 @Test void unsupportedSearchEscapeStillReadsExactTableMetadata()throws Exception{
   try(Connection c=DriverManager.getConnection(url,"sa","")){
     var trace=new ArrayList<String>();
     var columns=Engine.columns(metadataFailure(c,"getSearchStringEscape",new SQLFeatureNotSupportedException()),a,"baseline","orders",trace);
     assertEquals(4,columns.size());assertTrue(trace.stream().noneMatch(x->x.contains("fallback SQL")));
   }
 }
 @Test void unsupportedColumnsUsesRealZeroRowQueryButPermissionsRemainErrors()throws Exception{
   try(Connection c=DriverManager.getConnection(url,"sa","")){
     var trace=new ArrayList<String>();
     var columns=Engine.columns(metadataFailure(c,"getColumns",new SQLFeatureNotSupportedException()),a,"baseline","orders",trace);
     assertEquals(4,columns.size());assertTrue(trace.stream().anyMatch(x->x.contains("WHERE 1 = 0")));
     SQLException denied=new SQLException("permission denied","42501");
     assertSame(denied,assertThrows(SQLException.class,()->Engine.columns(metadataFailure(c,"getColumns",denied),a,"baseline","orders")));
   }
 }
 ObjectNode compare(String d){return Engine.compare(plan,group,mapping,strategy,d,a,b,()->false);}
 @Test void identicalDimensionsAndLargeIntegerEvidence(){for(String d:List.of("schema","count","data")){ObjectNode r=compare(d);assertEquals("passed",r.path("status").asText(),r.toString());}assertTrue(compare("data").toString().contains("9007199254740993"));}
 @Test void detectsMissingRowsAndExactCount()throws Exception{sql("DELETE FROM target.orders WHERE id=2");assertEquals("different",compare("count").path("status").asText());ObjectNode r=compare("data");assertEquals(1,r.path("differenceCount").asInt());assertEquals("目标缺少记录",r.path("differences").get(0).path("reason").asText());}
 @Test void decimalToleranceUsesBigDecimal()throws Exception{sql("UPDATE target.orders SET amount=100.123459 WHERE id=9007199254740993");assertEquals("different",compare("data").path("status").asText());strategy.put("ignorePrecision",true).put("tolerance","0.000003");ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals(1,r.path("ignoredCount").asInt());strategy.put("tolerance","0.000002");assertEquals("different",compare("data").path("status").asText());}
 @Test void ignoreValuesDoNotMaskOrdinaryValues()throws Exception{sql("UPDATE target.orders SET note='\\N' WHERE id=2");strategy.withArray("ignoredValues").add("\\N");assertEquals("passed",compare("data").path("status").asText());sql("UPDATE target.orders SET note='ordinary' WHERE id=2");assertEquals("different",compare("data").path("status").asText());}
 @Test void filterBindingAndFallback()throws Exception{strategy.put("filter","dt = ${biz_date}");assertEquals("2",compare("data").path("baseline").path("rowCount").asText());sql("ALTER TABLE target.orders RENAME COLUMN dt TO business_date");strategy.put("fallbackFilter","business_date = ${biz_date}");ObjectNode r=compare("count");assertEquals("error",r.path("status").asText(),r.toString());assertTrue(r.path("error").asText().contains("表级筛选字段"));}
 @Test void valuesCannotInjectSQL(){((ObjectNode)plan.path("variables").get(0)).put("value","x' OR 1=1 --");Engine.Query q=Engine.compile("SELECT * FROM ${table} WHERE dt=${biz_date}",plan,"baseline","orders",100);assertEquals("SELECT * FROM `baseline`.`orders` WHERE dt=?",q.sql());assertEquals("x' OR 1=1 --",q.params().get(0));assertThrows(IllegalArgumentException.class,()->Engine.compile("SELECT * FROM ${table} WHERE dt='${biz_date}'",plan,"baseline","orders",100));}
 @Test void destructiveSqlAndMultipleStatementsRejected(){for(String s:List.of("DELETE FROM orders","SELECT * FROM orders; DROP TABLE orders","WITH x AS (DELETE FROM orders) SELECT * FROM x","SELECT 1 INTO OUTFILE '/tmp/a'","SELECT 1 /*! DROP TABLE a */"))assertThrows(IllegalArgumentException.class,()->Engine.readOnly(s));Engine.readOnly("SELECT 'drop; delete' AS note");}
 @Test void sampleLimitAndUnknownVariable(){strategy.put("limit","10001");assertEquals("error",compare("data").path("status").asText());strategy.put("limit","${missing}");assertTrue(compare("data").path("error").asText().contains("未定义变量"));}
 @Test void duplicateKeysFailInsteadOfFalsePass()throws Exception{strategy.put("key","dt");ObjectNode r=compare("data");assertEquals("error",r.path("status").asText());assertTrue(r.path("error").asText().contains("不唯一"));}
 @Test void fallbackOrderWorksWhenAlignmentKeyIsEmpty()throws Exception{strategy.put("key","");for(String s:List.of("baseline","target"))sql("ALTER TABLE "+s+".orders RENAME COLUMN id TO order_id");ObjectNode r=compare("data");assertEquals("error",r.path("status").asText(),r.toString());assertTrue(r.path("error").asText().contains("排序字段"));}
 @Test void customSqlIsExecutedAndTraceable(){strategy.withObject("sql").withObject("data").put("baseline","SELECT id, amount FROM ${table} WHERE dt=${biz_date} ORDER BY id LIMIT ${limit}").put("target","SELECT id, amount FROM ${table} WHERE dt=${biz_date} ORDER BY id LIMIT ${limit}");ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals("2",r.path("baseline").path("rowCount").asText());assertEquals("2026-09-04",r.path("baseline").path("parameters").path("1").asText());}
 @Test void numericStringsAreNotToleratedAsNumericColumns()throws Exception{sql("UPDATE baseline.orders SET note='100' WHERE id=2");sql("UPDATE target.orders SET note='101' WHERE id=2");strategy.put("ignorePrecision",true).put("tolerance","2");assertEquals("different",compare("data").path("status").asText());}
 @Test void stringKeysPreserveLeadingZeros(){ObjectNode a=j.createObjectNode().put("id","001"),b=j.createObjectNode().put("id","1");assertNotEquals(Engine.key(a,List.of("id")),Engine.key(b,List.of("id")));}
 @Test void fullDataExceedsSampleCapAndRetainsBoundedEvidence()throws Exception{try(Connection c=DriverManager.getConnection(url,"sa","");Statement st=c.createStatement()){for(String schema:List.of("baseline","target"))st.execute("INSERT INTO "+schema+".orders SELECT \"X\"+100, 1.25, 'bulk', '2026-09-04' FROM SYSTEM_RANGE(1,10050)");}strategy.put("mode","full");ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals("10053",r.path("baseline").path("rowCount").asText());assertEquals(100,r.path("baseline").path("rows").size());assertTrue(r.path("baseline").path("truncated").asBoolean());strategy.put("alignment","position");ObjectNode positional=compare("data");assertEquals("passed",positional.path("status").asText(),positional.toString());assertEquals("10053",positional.path("baseline").path("rowCount").asText());assertEquals(100,positional.path("baseline").path("rows").size());}
 @Test void pauseResumeAndPersistedResult()throws Exception{Runner.data=Files.createTempDirectory("prism-job-test-");ObjectNode run=j.createObjectNode().put("id",UUID.randomUUID().toString()).put("status","queued").put("completedTables",0);run.set("snapshot",plan);run.putArray("results");Runner.Job job=new Runner.Job(run,j.createArrayNode().add(a).add(b));job.control("pause");Thread t=new Thread(job::execute);t.start();long deadline=System.currentTimeMillis()+5000;while(!job.snapshot().path("status").asText().equals("paused")&&System.currentTimeMillis()<deadline)Thread.sleep(10);assertEquals(0,job.snapshot().path("completedTables").asInt());job.control("resume");t.join(15000);assertFalse(t.isAlive());assertEquals("completed",job.snapshot().path("status").asText());assertEquals(3,job.snapshot().path("results").size());String persisted=Files.readString(Runner.data.resolve(run.path("id").asText()+".json"));assertFalse(persisted.contains("jdbc:h2"));}
 @Test void auditIncludesExactValuesRuleAndResolvedTolerance()throws Exception{
  sql("UPDATE target.orders SET amount=100.123459 WHERE id=9007199254740993");strategy.put("ignorePrecision",true).put("tolerance","${epsilon}");plan.withArray("variables").addObject().put("name","epsilon").put("value","0.000003").put("type","number");ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText());JsonNode d=r.path("ignoredDifferences").get(0);assertEquals("100.123456",d.path("baseline").asText());assertEquals("100.123459",d.path("target").asText());assertEquals("0.000003",d.path("delta").asText());assertEquals("0.000003",d.path("ruleValue").asText());assertEquals("absolute_tolerance",d.path("rule").asText());
 }
 @Test void specialNullContentsAreAudited()throws Exception{sql("UPDATE target.orders SET note='\\N' WHERE id=2");strategy.withArray("ignoredValues").add("\\N");JsonNode d=compare("data").path("ignoredDifferences").get(0);assertTrue(d.path("baseline").isNull());assertEquals("\\N",d.path("target").asText());assertEquals("null_equivalence",d.path("rule").asText());}
 @Test void schemaPrecisionLossIsAudited()throws Exception{sql("ALTER TABLE target.orders ALTER COLUMN amount DECIMAL(18,3)");strategy.put("ignorePrecision",true);ObjectNode r=compare("schema");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals(2,r.path("ignoredCount").asInt());assertTrue(r.path("ignoredDifferences").findValuesAsText("rule").stream().allMatch(x->x.equals("schema_precision")));}
 @Test void fullAuditSinkRetainsEveryIgnoredDifferenceBeyondPreviewCap()throws Exception{try(Connection c=DriverManager.getConnection(url,"sa","");Statement st=c.createStatement()){for(String schema:List.of("baseline","target"))st.execute("INSERT INTO "+schema+".orders SELECT \"X\"+100, 1.25, 'bulk', '2026-09-04' FROM SYSTEM_RANGE(1,1500)");st.execute("UPDATE target.orders SET amount=1.250001 WHERE id BETWEEN 101 AND 1600");}strategy.put("mode","full").put("ignorePrecision",true).put("tolerance","0.00001");java.util.List<ObjectNode> audit=new ArrayList<>();try{Engine.AUDIT.set(audit::add);ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals(1500,r.path("ignoredCount").asInt());assertEquals(1000,r.path("ignoredDifferences").size());assertEquals(1500,audit.size());}finally{Engine.AUDIT.remove();}}
 @Test void auditWriteFailureCannotBecomeAPass()throws Exception{sql("UPDATE target.orders SET amount=100.123459 WHERE id=9007199254740993");strategy.put("ignorePrecision",true).put("tolerance","0.01");try{Engine.AUDIT.set(d->{throw new java.io.IOException("disk full");});ObjectNode r=compare("data");assertEquals("error",r.path("status").asText());assertTrue(r.path("error").asText().contains("审计写入失败"));}finally{Engine.AUDIT.remove();}}
 @Test void failedQueriesRetainSqlAndBindingsWithoutLeakingIntoNextResult(){
  strategy.withObject("sql").withObject("count").put("baseline","SELECT missing_column FROM ${table} WHERE dt=${biz_date}");
  ObjectNode failed=compare("count");
  assertEquals("error",failed.path("status").asText());
  JsonNode event=failed.path("executionTrace").get(0);
  assertTrue(event.path("sql").asText().contains("missing_column"));
  assertTrue(event.path("sql").asText().contains("dt=?"));
  assertEquals("2026-09-04",event.path("parameters").get(0).asText());
  assertEquals(a.path("id").asText(),event.path("sourceId").asText());
  assertFalse(event.path("at").asText().isBlank());
  assertNull(Engine.TRACE.get());
  assertFalse(compare("schema").path("executionTrace").toString().contains("missing_column"));
 }


 @Test void nonDecimalScaleSentinelsDoNotMaskRealDecimalChanges(){
   String sql="SELECT 'text_col' AS name, 'STRING' AS type, true AS nullable, 50 AS precision, %d AS scale UNION ALL SELECT 'int_col', 'BIGINT', true, 19, %d UNION ALL SELECT 'amount', 'DECIMAL', true, 20, %d";
   strategy.withObject("sql").withObject("schema").put("baseline",sql.formatted(0,0,6)).put("target",sql.formatted(1,1,6));
   ObjectNode same=compare("schema");assertEquals("passed",same.path("status").asText(),same.toString());
   assertEquals(0,same.path("ignoredCount").asInt());assertEquals(2,same.path("schemaNoteCount").asInt());
   assertEquals(1,same.path("target").path("rows").get(0).path("scale").asInt());
   assertTrue(same.path("ignoredDifferences").isEmpty());assertEquals("scale",same.path("schemaNotes").get(0).path("column").asText());
   strategy.withObject("sql").withObject("schema").put("target",sql.formatted(1,1,3));
   ObjectNode changed=compare("schema");assertEquals("different",changed.path("status").asText(),changed.toString());
   assertEquals(1,changed.path("differenceCount").asInt());assertEquals("amount",changed.path("differences").get(0).path("key").asText());
 }
 @Test void countDoesNotAskDriverToCastLongToBigDecimal()throws Exception{
   try(Connection actual=DriverManager.getConnection(url,"sa","")){
     Connection c=(Connection)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
       try{
         Object value=method.invoke(actual,args);
         if(!method.getName().equals("prepareStatement"))return value;
         PreparedStatement statement=(PreparedStatement)value;
         return java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{PreparedStatement.class},(sp,sm,sa)->{
           try{
             Object result=sm.invoke(statement,sa);
             if(!sm.getName().equals("executeQuery"))return result;
             ResultSet rs=(ResultSet)result;
             return java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{ResultSet.class},(rp,rm,ra)->{
               if(rm.getName().equals("getBigDecimal"))throw new SQLException("Cannot transform ODPS-SDK Java class java.lang.Long to java.math.BigDecimal");
               try{return rm.invoke(rs,ra);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
             });
           }catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
         });
       }catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
     });
     for(String value:List.of("9007199254740993","9223372036854775807","123456789012345678901234567890"))assertEquals(value,Engine.count(c,a,new Engine.Query("SELECT "+value,List.of())).toPlainString());
     for(String sql:List.of("SELECT NULL","SELECT -1","SELECT 1.5","SELECT 'bad'","SELECT 1 UNION ALL SELECT 2","SELECT 1,2","SELECT 1 WHERE false"))assertThrows(IllegalArgumentException.class,()->Engine.count(c,a,new Engine.Query(sql,List.of())),sql);
   }
 }
 @Test void explicitMissingKeyCannotSilentlyBecomeFallbackOrder()throws Exception{
   for(String schema:List.of("baseline","target"))sql("ALTER TABLE "+schema+".orders RENAME COLUMN id TO order_id");
   strategy.put("order","order_id ASC");ObjectNode r=compare("data");assertEquals("error",r.path("status").asText());assertTrue(r.path("error").asText().contains("显式对齐键不会"));
 }
 @Test void duplicateSortFieldIsAllowedWithSeparateOrCompositeKey()throws Exception{
   strategy.put("order","dt ASC").put("key","");
   ObjectNode fail=compare("data");assertEquals("error",fail.path("status").asText());
   String error=fail.path("error").asText();assertTrue(error.contains("基准侧"));assertTrue(error.contains("orders"));assertTrue(error.contains("沿用排序字段"));assertTrue(error.contains("不唯一"));
   strategy.put("key","dt,id");assertEquals("passed",compare("data").path("status").asText());
   strategy.put("key","id");assertEquals("passed",compare("data").path("status").asText());
 }
 @Test void nullAndMissingResultKeysHaveDistinctActionableErrors()throws Exception{
   strategy.put("key","id,note");ObjectNode nullResult=compare("data");
   assertEquals("error",nullResult.path("status").asText());assertTrue(nullResult.path("error").asText().contains("数据对齐键包含 NULL：note"));
   assertTrue(nullResult.path("error").asText().contains("基准侧"));
   strategy.put("key","id");strategy.withObject("sql").withObject("data").put("target","SELECT amount FROM ${table} ORDER BY id LIMIT ${limit}");
   ObjectNode missing=compare("data");assertEquals("error",missing.path("status").asText());assertTrue(missing.path("error").asText().contains("目标侧"));assertTrue(missing.path("error").asText().contains("查询结果缺少数据对齐键字段：id"));assertFalse(missing.path("error").asText().contains("包含 NULL"));
 }


 @Test void positionComparisonAllowsDuplicateAndNullSortValuesInSampleAndFull()throws Exception{
   for(String schema:List.of("baseline","target")){sql("ALTER TABLE "+schema+".orders ADD ts BIGINT");sql("UPDATE "+schema+".orders SET ts=1788623990 WHERE id<>2");}
   strategy.put("alignment","position").put("order","ts ASC,id ASC").put("key","missing_key");
   for(String mode:List.of("sample","full")){strategy.put("mode",mode);ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals("position",r.path("alignmentMode").asText());assertTrue(r.path("alignmentKeys").isEmpty());assertEquals("3",r.path("baseline").path("rowCount").asText());}
 }
 @Test void positionCustomSqlDoesNotRequireTableSortFieldsOrKeyColumns(){
   strategy.put("alignment","position").put("order","does_not_exist").put("fallbackOrder","").put("key","does_not_exist");
   strategy.withObject("sql").withObject("data").put("baseline","SELECT note AS text_value FROM ${table} ORDER BY id LIMIT ${limit}").put("target","SELECT note AS text_value FROM ${table} ORDER BY id LIMIT ${limit}");
   ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText(),r.toString());assertEquals(1,r.path("baseline").path("columns").size());
 }
 @Test void positionComparisonFollowsReturnedOrderInsteadOfJoiningKeys(){
   strategy.put("alignment","position").put("mode","full");
   strategy.withObject("sql").withObject("data").put("baseline","SELECT * FROM ${table} ORDER BY id ASC").put("target","SELECT * FROM ${table} ORDER BY id DESC");
   ObjectNode r=compare("data");assertEquals("different",r.path("status").asText(),r.toString());assertEquals("第 1 行",r.path("differences").get(0).path("key").asText());
   strategy.put("alignment","key");assertEquals("passed",compare("data").path("status").asText());
 }
 @Test void positionComparisonRetainsRepeatedRowsAndReportsTailRows()throws Exception{
   for(String schema:List.of("baseline","target")){sql("CREATE TABLE "+schema+".repeated_rows(ts BIGINT, note VARCHAR(20))");sql("INSERT INTO "+schema+".repeated_rows SELECT 1, 'same' FROM SYSTEM_RANGE(1,12)");}
   mapping.put("baselineTable","repeated_rows").put("targetTable","repeated_rows");strategy.put("alignment","position").put("order","ts");
   assertEquals("passed",compare("data").path("status").asText());
   sql("INSERT INTO target.repeated_rows VALUES (1, 'same')");ObjectNode r=compare("data");assertEquals("different",r.path("status").asText());assertEquals(1,r.path("differenceCount").asInt());assertEquals("第 13 行",r.path("differences").get(0).path("key").asText());assertEquals("基准缺少记录",r.path("differences").get(0).path("reason").asText());
   sql("DELETE FROM baseline.repeated_rows");assertEquals(13,compare("data").path("differenceCount").asInt());sql("DELETE FROM target.repeated_rows");assertEquals("passed",compare("data").path("status").asText());
 }
 @Test void positionComparisonStillAuditsToleratedValues()throws Exception{
   sql("UPDATE target.orders SET amount=100.123459 WHERE id=9007199254740993");strategy.put("alignment","position").put("ignorePrecision",true).put("tolerance","0.000003");ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText());assertEquals(1,r.path("ignoredCount").asInt());assertEquals("第 3 行",r.path("ignoredDifferences").get(0).path("key").asText());
 }
 @Test void customPositionalSqlRequiresOuterOrderingInFullMode(){
   strategy.put("alignment","position").put("mode","full");
   for(String sql:List.of("SELECT * FROM ${table}","SELECT * FROM (SELECT * FROM ${table} ORDER BY id) t","SELECT row_number() OVER (ORDER BY id) AS n FROM ${table}")){
     strategy.withObject("sql").withObject("data").put("baseline",sql);ObjectNode r=compare("data");assertEquals("error",r.path("status").asText());assertTrue(r.path("error").asText().contains("最外层"),r.toString());
   }
   assertTrue(Engine.topLevelOrder("WITH t AS (SELECT 1) SELECT * FROM t ORDER\nBY 1"));
 }

 @Test void schemaCompatibilityNotesNeverEnterToleranceAudit(){
   String sql="SELECT 'text_col' AS name, 'STRING' AS type, true AS nullable, 50 AS precision, %d AS scale";
   strategy.withObject("sql").withObject("schema").put("baseline",sql.formatted(0)).put("target",sql.formatted(1));
   List<ObjectNode> events=new ArrayList<>();try{Engine.AUDIT.set(events::add);ObjectNode r=compare("schema");assertEquals("passed",r.path("status").asText());assertEquals(0,r.path("ignoredCount").asInt());assertEquals(1,r.path("schemaNoteCount").asInt());assertTrue(events.isEmpty());}finally{Engine.AUDIT.remove();}
 }
 @Test void pairedRowsKeepFullEvidenceBeyondRawPreviewAndBoundTheirOwnSize()throws Exception{
   for(String schema:List.of("baseline","target")){sql("CREATE TABLE "+schema+".bulk(id BIGINT, note VARCHAR(20))");sql("INSERT INTO "+schema+".bulk SELECT \"X\",'same' FROM SYSTEM_RANGE(1,150)");}
   mapping.put("baselineTable","bulk").put("targetTable","bulk");strategy.put("alignment","position").put("mode","full");sql("UPDATE target.bulk SET note='changed' WHERE id=120");
   ObjectNode r=compare("data");assertEquals("different",r.path("status").asText(),r.toString());assertEquals(100,r.path("baseline").path("rows").size());assertEquals(1,r.path("differentRowCount").asInt());JsonNode row=r.path("rowDifferences").get(0);assertEquals("第 120 行",row.path("key").asText());assertEquals("120",row.path("baseline").path("id").asText());assertEquals("same",row.path("baseline").path("note").asText());assertEquals("changed",row.path("target").path("note").asText());assertEquals(j.readTree("[\"note\"]"),row.path("changedColumns"));
   sql("UPDATE target.bulk SET note='changed'");r=compare("data");assertEquals(150,r.path("differentRowCount").asInt());assertEquals(100,r.path("rowDifferences").size());assertEquals(150,r.path("differenceCount").asInt());
 }
 @Test void pairedRowsDistinguishMissingRecordsAndHighlightOnlyUnacceptedFields()throws Exception{
   sql("DELETE FROM target.orders WHERE id=2");ObjectNode missing=compare("data");JsonNode row=missing.path("rowDifferences").get(0);assertTrue(row.path("target").isNull());assertEquals("2",row.path("baseline").path("id").asText());assertEquals(4,row.path("changedColumns").size());
   sql("UPDATE target.orders SET amount=100.123459,note='changed' WHERE id=9007199254740993");strategy.put("ignorePrecision",true).put("tolerance","0.000003");ObjectNode r=compare("data");assertEquals(1,r.path("ignoredCount").asInt());assertEquals(2,r.path("differentRowCount").asInt());row=r.path("rowDifferences").get(1);assertEquals(j.readTree("[\"note\"]"),row.path("changedColumns"));assertEquals("100.123459",row.path("target").path("amount").asText());
 }

 Connection cloudCatalogConnection(Connection actual,List<String> calls,boolean denied)throws Exception{
   DatabaseMetaData meta=(DatabaseMetaData)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{DatabaseMetaData.class},(proxy,method,args)->{
     if(method.getName().equals("getSchemas")){
       assertEquals("`analytics`",args[0]);assertNull(args[1]);calls.add("schemas");
       return actual.createStatement().executeQuery("SELECT 'baseline' AS TABLE_SCHEM UNION ALL SELECT 'target' UNION ALL SELECT 'baseline' UNION ALL SELECT '' UNION ALL SELECT 'INFORMATION_SCHEMA'");
     }
     if(method.getName().equals("getTables")){
       assertEquals("`analytics`",args[0]);assertNotNull(args[1]);assertNull(args[2]);String schema=args[1].toString();calls.add(schema);
       if(denied&&schema.equals("`target`"))throw new SQLException("permission denied","42501");
       return actual.getMetaData().getTables(null,schema.replace("`",""),"%",(String[])args[3]);
     }
     try{return method.invoke(actual.getMetaData(),args);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
   });
   return (Connection)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{Connection.class},(proxy,method,args)->{
     if(method.getName().equals("getMetaData"))return meta;
     if(method.getName().equals("getCatalog"))return "analytics";
     try{return method.invoke(actual,args);}catch(java.lang.reflect.InvocationTargetException e){throw e.getCause();}
   });
 }
 @Test void cloudCatalogEnumeratesAllSchemasWithAndWithoutDefaultSchema()throws Exception{
   try(Connection c=DriverManager.getConnection(url,"sa","")){
     for(String defaultSchema:List.of("","baseline")){
       List<String> calls=new ArrayList<>();ObjectNode source=a.deepCopy().put("type","lakehouse").put("catalog","analytics").put("schema",defaultSchema);
       JsonNode result=Engine.catalog(cloudCatalogConnection(c,calls,false),source);
       assertFalse(result.has("namespaceMode"));assertFalse(result.has("project"));
       assertEquals(List.of("schemas","`baseline`","`target`"),calls);
       assertEquals(2,result.path("tables").size());assertEquals(2,result.path("schemas").size());
       assertEquals("baseline",result.path("tables").get(0).path("schema").asText());assertEquals("target",result.path("tables").get(1).path("schema").asText());
       assertEquals("orders",result.path("tables").get(0).path("name").asText());assertEquals("orders",result.path("tables").get(1).path("name").asText());
       assertEquals("analytics",result.path("tables").get(1).path("catalog").asText());
     }
   }
 }
 @Test void cloudCatalogUsesResolvedWorkspaceAndDoesNotSilentlyHidePermissionFailures()throws Exception{
   try(Connection c=DriverManager.getConnection(url,"sa","")){
     ObjectNode source=a.deepCopy().put("type","lakehouse").put("catalog","");
     assertEquals(2,Engine.catalog(cloudCatalogConnection(c,new ArrayList<>(),false),source).path("tables").size());
     SQLException error=assertThrows(SQLException.class,()->Engine.catalog(cloudCatalogConnection(c,new ArrayList<>(),true),source));
     assertEquals("42501",error.getSQLState());assertTrue(error.getMessage().contains("Schema=target"));assertTrue(error.getMessage().contains("Workspace=analytics"));
     assertEquals(2,Engine.catalog(c,a).path("tables").size());
   }
 }

 @Test void tableStructureEndpointReadsSelectedTableWithoutReturningBusinessRows()throws Exception{
   ObjectNode request=j.createObjectNode().put("schema","baseline").put("table","orders");request.set("source",a);
   JsonNode result=Engine.describeTable(request);assertEquals(4,result.path("columns").size());assertEquals("id",result.path("columns").get(0).path("name").asText());assertEquals("BIGINT",result.path("columns").get(0).path("type").asText());assertFalse(result.toString().contains("9007199254740993"));assertFalse(result.has("rows"));
   request.put("table","");assertThrows(IllegalArgumentException.class,()->Engine.describeTable(request));
 }

 @Test void excludedFieldsAreAuditedWithoutMaskingRowsOrOtherDimensions()throws Exception{
   sql("UPDATE target.orders SET note='different' WHERE id=2");strategy.putArray("ignoredColumns").add("NOTE");ObjectNode r=compare("data");assertEquals("passed",r.path("status").asText());assertEquals(1,r.path("ignoredCount").asInt());assertEquals("excluded_column",r.path("ignoredDifferences").get(0).path("rule").asText());assertEquals(0,r.path("differentRowCount").asInt());
   sql("UPDATE target.orders SET amount=21 WHERE id=2");r=compare("data");assertEquals("different",r.path("status").asText());assertEquals("amount",r.path("rowDifferences").get(0).path("changedColumns").get(0).asText());
   sql("DELETE FROM target.orders WHERE id=2");assertEquals("different",compare("data").path("status").asText());assertEquals("different",compare("count").path("status").asText());
   sql("ALTER TABLE target.orders DROP COLUMN note");assertEquals("different",compare("schema").path("status").asText());
 }
 @Test void tableOverridesDoNotUseAnyHiddenFallbacks()throws Exception{
   for(String schema:List.of("baseline","target"))sql("ALTER TABLE "+schema+".orders RENAME COLUMN id TO order_id");
   mapping.put("override",true);strategy.put("key","");
   ObjectNode local=strategy.deepCopy();local.put("fallbackOrder","missing");
   JsonNode merged=Engine.effectiveStrategy(plan,mapping,local);
   assertEquals("",merged.path("fallbackOrder").asText());
   ObjectNode r=Engine.compare(plan,group,mapping,merged,"data",a,b,()->false);
   assertEquals("error",r.path("status").asText(),r.toString());
 }
 @Test void tableStrategyKeepsBlankLocalFilterAndMergesEachSqlSide()throws Exception{
   mapping.put("override",true);strategy.put("filter","dt = ${biz_date}").put("ignorePrecision",true);
   ((ObjectNode)strategy.path("sql").path("data")).put("baseline","SELECT * FROM baseline.orders").put("target","SELECT * FROM target.orders");
   ObjectNode local=j.createObjectNode().put("filter","").put("order","dt DESC").put("ignorePrecision",false).put("limit","0");
   local.putArray("specified").add("filter").add("order").add("ignorePrecision").add("sql.data.target");
   local.putObject("sql").putObject("data").put("target","SELECT id FROM target.orders");
   JsonNode merged=Engine.effectiveStrategy(plan,mapping,local);
   assertEquals("",merged.path("filter").asText());assertEquals("dt DESC",merged.path("order").asText());assertFalse(merged.path("ignorePrecision").asBoolean());assertEquals("100",merged.path("limit").asText());
   assertEquals("SELECT * FROM baseline.orders",merged.path("sql").path("data").path("baseline").asText());assertEquals("SELECT id FROM target.orders",merged.path("sql").path("data").path("target").asText());
 }
 @Test void removedGlobalRulesCannotAffectExecution()throws Exception{
   mapping.put("override",false);strategy.put("filter","missing = ${removed}").put("order","missing").put("key","missing").put("alignment","invalid");
   ObjectNode result=compare("count");assertEquals("passed",result.path("status").asText(),result.toString());assertEquals("3",result.path("baseline").path("rows").get(0).path("count").asText());assertEquals("",result.path("strategy").path("filter").asText());
   assertEquals("error",compare("data").path("status").asText());
 }

 @Test void frozenMappingIsSkippedByJobWithoutQueryingMissingTable()throws Exception{
   Path previous=Runner.data,temp=Files.createTempDirectory("prism-frozen-job-");Runner.data=temp;
   try{
     ObjectNode frozen=mapping.deepCopy().put("id","frozen").put("frozen",true).put("baselineTable","does_not_exist");
     ((ArrayNode)group.path("mappings")).insert(0,frozen);
     ObjectNode run=j.createObjectNode().put("id",UUID.randomUUID().toString()).put("status","queued").put("totalTables",1).put("completedTables",0);run.set("snapshot",plan.deepCopy());run.putArray("results");
     Runner.Job job=new Runner.Job(run,j.createArrayNode().add(a).add(b));job.execute();JsonNode result=job.snapshot();
     assertEquals("completed",result.path("status").asText(),result.toString());assertEquals(1,result.path("completedTables").asInt());assertEquals(3,result.path("results").size());for(JsonNode item:result.path("results")){assertFalse(item.path("id").asText().startsWith("frozen:"));assertEquals("passed",item.path("status").asText(),item.toString());}
     assertTrue(result.path("snapshot").path("groups").get(0).path("mappings").get(0).path("frozen").asBoolean());
   }finally{Runner.data=previous;try(var files=Files.walk(temp)){for(Path path:files.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}}
 }

 @Test void timestampTolerancePreservesRawEvidenceAndHonorsThreshold()throws Exception{
   sql("UPDATE baseline.orders SET note='2026-06-29 17:54:04' WHERE id=2");sql("UPDATE target.orders SET note='2026-06-29 17:54:04.637' WHERE id=2");
   assertEquals("different",compare("data").path("status").asText());strategy.put("ignoreTimeDifference",true).put("timeToleranceSeconds","1");
   ObjectNode result=compare("data");assertEquals("passed",result.path("status").asText(),result.toString());JsonNode evidence=result.path("ignoredDifferences").get(0);assertEquals("time_tolerance",evidence.path("rule").asText());assertEquals("0.637",evidence.path("delta").asText());assertEquals("1 秒",evidence.path("ruleValue").asText());assertEquals("2026-06-29 17:54:04.637",evidence.path("target").asText());
   strategy.put("timeToleranceSeconds","0.636");assertEquals("different",compare("data").path("status").asText());strategy.put("timeToleranceSeconds","0.637");assertEquals("passed",compare("data").path("status").asText());
   strategy.put("timeToleranceSeconds","-1");assertEquals("error",compare("data").path("status").asText());
 }
 @Test void timeParserHandlesIsoOffsetsAndRejectsAmbiguousOrInvalidValues(){
   assertEquals("0.107",TimeTolerance.delta("2026-09-11T08:29:22.616Z","2026-09-11T08:29:22.509Z").toPlainString());
   assertEquals("0",TimeTolerance.delta("2026-09-11T16:29:22+08:00","2026-09-11T08:29:22Z").toPlainString());
   assertEquals("0.000000001",TimeTolerance.delta("2026-09-11 08:29:22.000000001","2026-09-11 08:29:22").toPlainString());
   assertNull(TimeTolerance.delta("2026-09-11 08:29:22","2026-09-11T08:29:22Z"));assertNull(TimeTolerance.delta("2026-02-30 08:29:22","2026-03-02 08:29:22"));assertNull(TimeTolerance.delta("123","124"));
 }

 @Test void sameSourceDifferentTablesUseSeparateMappings()throws Exception{
   sql("CREATE TABLE baseline.orders_copy AS SELECT * FROM baseline.orders");
   group.put("targetId","a");mapping.put("targetSchema","baseline").put("targetTable","orders_copy");
   for(String dimension:List.of("schema","count","data")){
     ObjectNode result=Engine.compare(plan,group,mapping,strategy,dimension,a,a,()->false);
     assertNotEquals("error",result.path("status").asText(),result.toString());
     if(!dimension.equals("schema"))assertEquals("passed",result.path("status").asText(),result.toString());
   }
   sql("UPDATE baseline.orders_copy SET amount=999 WHERE id=2");
   ObjectNode diff=Engine.compare(plan,group,mapping,strategy,"data",a,a,()->false);
   assertEquals("different",diff.path("status").asText(),diff.toString());
   assertTrue(diff.path("baseline").path("sql").asText().contains("orders"));
   assertTrue(diff.path("target").path("sql").asText().contains("orders_copy"));
 }
 @Test void comparisonReportsSidesQueriesReadsAndLocalComparison(){
   List<ObjectNode> events=new ArrayList<>();ExecutionProgress.attach(e->events.add(e.deepCopy()));
   try{assertEquals("passed",compare("data").path("status").asText());}finally{ExecutionProgress.clear();}
   assertTrue(events.stream().anyMatch(e->e.path("stage").asText().equals("connecting")&&e.path("side").asText().equals("baseline")));
   assertTrue(events.stream().anyMatch(e->e.path("stage").asText().equals("querying")&&e.path("side").asText().equals("target")&&e.has("sql")));
   assertTrue(events.stream().anyMatch(e->e.path("stage").asText().equals("read_complete")&&e.path("rows").asText().equals("3")));
   assertTrue(events.stream().anyMatch(e->e.path("stage").asText().equals("compared")&&e.path("rows").asText().equals("3")&&!e.has("side")));
   assertTrue(events.stream().noneMatch(e->e.has("parameters")||e.has("password")));
 }
}
