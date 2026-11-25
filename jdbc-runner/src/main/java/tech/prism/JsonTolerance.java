package tech.prism;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.*;
import java.util.*;
final class JsonTolerance {
 private static final ObjectMapper JSON=new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS);
 static boolean equivalent(JsonNode a,JsonNode b){if(a==null||b==null||!a.isTextual()||!b.isTextual())return false;try{JsonNode x=JSON.readTree(a.asText()),y=JSON.readTree(b.asText());return x!=null&&y!=null&&x.isContainerNode()&&y.isContainerNode()&&same(x,y);}catch(Exception e){return false;}}
 private static boolean same(JsonNode a,JsonNode b){if(a.isNumber()&&b.isNumber())return a.decimalValue().compareTo(b.decimalValue())==0;if(a.isObject()&&b.isObject()){if(a.size()!=b.size())return false;Iterator<String> keys=a.fieldNames();while(keys.hasNext()){String k=keys.next();if(!b.has(k)||!same(a.get(k),b.get(k)))return false;}return true;}if(a.isArray()&&b.isArray()){if(a.size()!=b.size())return false;for(int i=0;i<a.size();i++)if(!same(a.get(i),b.get(i)))return false;return true;}return a.equals(b);}
}
