package tech.prism;
import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class JsonToleranceTest {
 boolean same(String a,String b){return JsonTolerance.equivalent(TextNode.valueOf(a),TextNode.valueOf(b));}
 @Test void nestedObjectsAndExactNumbers(){assertTrue(same("{\"k1\":\"v1\",\"k2\":{\"a\":1,\"b\":2}}","{\"k2\":{\"b\":2,\"a\":1},\"k1\":\"v1\"}"));assertTrue(same("{\"x\":1.0}","{\"x\":1}"));assertFalse(same("{\"x\":9007199254740993}","{\"x\":9007199254740992}"));}
 @Test void rejectOtherDifferencesAndInvalidJson(){assertFalse(same("[1,2]","[2,1]"));assertFalse(same("{\"x\":1}","{\"x\":\"1\"}"));assertFalse(same("{}","{\"x\":null}"));assertFalse(same("{\"x\":1,\"x\":2}","{\"x\":2}"));assertFalse(same("{} trailing","{}"));assertFalse(same("null","null"));}
 @Test void strategySwitchAndAudit(){var s=Runner.JSON.createObjectNode();var p=Runner.JSON.createObjectNode();var a=TextNode.valueOf("{\"a\":1,\"b\":2}");var b=TextNode.valueOf("{\"b\":2,\"a\":1}");assertFalse(Engine.equal(a,b,s,p,false));s.put("ignoreJsonKeyOrder",true);assertTrue(Engine.equal(a,b,s,p,false));var result=Runner.JSON.createObjectNode();Engine.auditData(result,"1","json",a,b,s,p);assertEquals("json_key_order",result.path("ignoredDifferences").get(0).path("rule").asText());assertEquals(a,result.path("ignoredDifferences").get(0).path("baseline"));}
}
