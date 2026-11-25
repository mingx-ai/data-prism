package tech.prism;
import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import java.sql.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.lang.reflect.Proxy;
class ExecutionProgressTest {
 @TempDir Path temp;
 Path previous;
 @BeforeEach void setup(){previous=Runner.data;Runner.data=temp;}
 @AfterEach void cleanup(){Runner.data=previous;ExecutionProgress.clear();}
 Runner.Job job(){ObjectNode run=Runner.JSON.createObjectNode().put("id","progress-test").put("status","queued");run.putArray("results");return new Runner.Job(run,Runner.JSON.createArrayNode());}
 @Test void blockedJdbcCallStillExposesLiveStageAndStableStart()throws Exception{
   Runner.Job job=job();job.context.put("mappingId","table-one").put("groupId","group-one").put("dimension","data");
   CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);AtomicReference<Throwable> failure=new AtomicReference<>();AtomicBoolean cleared=new AtomicBoolean();
   PreparedStatement statement=(PreparedStatement)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{PreparedStatement.class},(proxy,method,args)->{if(method.getName().equals("executeQuery")){entered.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new SQLException("timeout");throw new SQLException("test database failure");}return null;});
   Thread worker=new Thread(()->{try{ExecutionProgress.attach(job::progress);ExecutionProgress.LOCAL.get().scope.put("side","target").put("sourceName","warehouse");ExecutionProgress.emit("preparing_sql","准备 SQL","SELECT * FROM target_table WHERE ds = ?",-1);ExecutionProgress.query(statement);}catch(Throwable e){failure.set(e);}finally{ExecutionProgress.clear();cleared.set(ExecutionProgress.LOCAL.get()==null);}});
   worker.start();try{assertTrue(entered.await(5,TimeUnit.SECONDS));ObjectNode first=job.snapshot(),second=job.snapshot();assertEquals("querying",first.path("progress").path("stage").asText());assertEquals("target",first.path("progress").path("side").asText());assertEquals("table-one",first.path("progress").path("mappingId").asText());assertEquals(first.path("progress").path("startedAt"),second.path("progress").path("startedAt"));assertTrue(first.has("gatewayObservedAt"));assertTrue(first.path("results").isEmpty());assertTrue(Files.readString(temp.resolve("progress-test.json")).contains("querying"));}finally{release.countDown();worker.join(5000);}assertFalse(worker.isAlive());assertInstanceOf(SQLException.class,failure.get());assertTrue(cleared.get());
 }
 @Test void boundedHistoryAndControlRequestsKeepCurrentStage()throws Exception{
   Runner.Job job=job();for(int i=0;i<210;i++)job.progress(Runner.JSON.createObjectNode().put("stage","step-"+i).put("message","step"));assertEquals(200,job.snapshot().path("progressEvents").size());
   job.run.put("status","running");job.worker=Thread.currentThread();job.control("pause");assertEquals("pausing",job.snapshot().path("status").asText());assertEquals("step-209",job.snapshot().path("progress").path("stage").asText());
   job.progress(Runner.JSON.createObjectNode().put("stage","step-209").put("message","step").put("rows","1000"));assertEquals("control",job.snapshot().path("progressEvents").get(198).path("stage").asText());assertEquals("1000",job.snapshot().path("progress").path("rows").asText());
   ObjectNode snapshot=job.snapshot();snapshot.withArray("progressEvents").removeAll();assertEquals(200,job.snapshot().path("progressEvents").size());
 }
}
