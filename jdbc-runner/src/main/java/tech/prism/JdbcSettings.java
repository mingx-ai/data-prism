package tech.prism;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Translate the separate form fields into the parameters each vendor actually reads. */
final class JdbcSettings {
  record Config(String url, Properties properties) {}

  static Config from(JsonNode source) {
    String type=source.path("type").asText(),url=source.path("jdbcUrl").asText().trim();
    String catalog=source.path("catalog").asText().trim(),schema=source.path("schema").asText().trim();
    Properties props=new Properties();
    props.setProperty("user",source.path("username").asText());
    props.setProperty("password",source.path("password").asText());
    if(type.equals("maxcompute")) {
      URI endpoint=uri(url.substring("jdbc:odps:".length()));
      if(!Set.of("http","https").contains(Objects.toString(endpoint.getScheme(),"")))throw new IllegalArgumentException("MaxCompute 地址必须包含 http:// 或 https:// 服务端点");
      Map<String,String> params=params(endpoint);
      String project=consistent(catalog,params.getOrDefault("project",""),"MaxCompute 项目名");
      if(project.isBlank())throw new IllegalArgumentException("缺少 MaxCompute 项目名：请填写「MaxCompute 项目名」，或在 JDBC 地址中添加 ?project=实际项目名；默认 Schema 不能代替项目名");
      props.setProperty("project_name",project);
      props.setProperty("access_id",source.path("username").asText());
      props.setProperty("access_key",source.path("password").asText());
      props.setProperty("connect_timeout","15");
      props.setProperty("read_timeout","120");
      // Keep an explicit URL schema; the form is a fallback for a bare endpoint.
      String resolvedSchema=params.getOrDefault("schema","");
      if(resolvedSchema.isBlank())resolvedSchema=schema;
      String mode=params.getOrDefault("odpsNamespaceSchema",params.getOrDefault("odps_namespace_schema",""));
      if(!mode.isBlank()&&!mode.equalsIgnoreCase("true")&&!mode.equalsIgnoreCase("false"))throw new IllegalArgumentException("odpsNamespaceSchema 必须为 true 或 false");
      boolean enabled=mode.isBlank()?params.containsKey("schema")||(!resolvedSchema.isBlank()&&!resolvedSchema.equalsIgnoreCase("default")):Boolean.parseBoolean(mode);
      props.setProperty("odps_namespace_schema",Boolean.toString(enabled));
      if(enabled){if(!resolvedSchema.isBlank())props.setProperty("schema",resolvedSchema);}
      else if(params.containsKey("schema")||(!resolvedSchema.isBlank()&&!resolvedSchema.equalsIgnoreCase("default")))throw new IllegalArgumentException("两层 MaxCompute 连接不能指定 Schema，请清空 Schema 并从 URL 移除 schema 参数；三层项目请显式使用 odpsNamespaceSchema=true");
    } else if(type.equals("lakehouse")) {
      URI endpoint=uri(url.substring("jdbc:".length()));
      String path=Objects.toString(endpoint.getPath(),"");
      String rawPath=Objects.toString(endpoint.getRawPath(),"");
      while(path.endsWith("/"))path=path.substring(0,path.length()-1);
      while(rawPath.endsWith("/"))rawPath=rawPath.substring(0,rawPath.length()-1);
      String urlWorkspace;
      if(path.isEmpty()||path.equalsIgnoreCase("/api"))urlWorkspace="";
      else if(path.startsWith("/api/")&&path.substring(5).indexOf('/')<0)urlWorkspace=path.substring(5);
      else if(path.startsWith("/")&&path.substring(1).indexOf('/')<0)urlWorkspace=path.substring(1);
      else throw new IllegalArgumentException("云器 JDBC 路径应为 /Workspace 或 /api/Workspace，请复制控制台的 JDBC 地址");
      String workspace=consistent(catalog,urlWorkspace,"云器 Workspace");
      if(workspace.isBlank())throw new IllegalArgumentException("缺少云器 Workspace：请填写「云器 Workspace」，或将 JDBC 地址补全为 /Workspace 或 /api/Workspace");
      if(urlWorkspace.isBlank())rawPath+="/"+encode(workspace);
      url="jdbc:clickzetta://"+endpoint.getRawAuthority()+rawPath+(endpoint.getRawQuery()==null?"":"?"+endpoint.getRawQuery());
      // ClickZetta 4.0.0 reads schema from the URL, not from Properties.
      if(!schema.isBlank()&&params(endpoint).getOrDefault("schema","").isBlank())url+=(url.contains("?")?"&":"?")+"schema="+encode(schema);
      Map<String,String> lakeParams=new LinkedHashMap<>();params(endpoint).forEach((k,v)->lakeParams.put(k.toLowerCase(Locale.ROOT),v));
      String urlCluster=lakeParams.getOrDefault("vcluster",lakeParams.getOrDefault("virtualcluster",""));
      String cluster=consistent(source.path("properties").path("virtualCluster").asText().trim(),urlCluster,"云器 Virtual Cluster");
      if(!cluster.isBlank()&&urlCluster.isBlank())url+=(url.contains("?")?"&":"?")+"virtualCluster="+encode(cluster);
    } else if(type.equals("mysql")) {
      props.setProperty("connectTimeout","15000");
      props.setProperty("socketTimeout","120000");
      props.setProperty("useCursorFetch","true");
    }
    return new Config(url,props);
  }

  private static URI uri(String url) {
    try {
      URI uri=URI.create(url);
      // Raw authority also accepts vendor instance names containing underscores.
      if(uri.getRawAuthority()==null||uri.getRawAuthority().contains("@")||uri.getRawFragment()!=null)throw new IllegalArgumentException();
      return uri;
    } catch(IllegalArgumentException error) {
      throw new IllegalArgumentException("JDBC 地址格式无效，请填写完整服务地址，账号和密码使用独立字段");
    }
  }
  private static Map<String,String> params(URI uri) {
    Map<String,String> result=new LinkedHashMap<>();
    if(uri.getRawQuery()!=null)for(String pair:uri.getRawQuery().split("&")) {
      String[] parts=pair.split("=",2);
      result.put(URLDecoder.decode(parts[0],StandardCharsets.UTF_8),parts.length<2?"":URLDecoder.decode(parts[1],StandardCharsets.UTF_8).trim());
    }
    return result;
  }
  private static String consistent(String field,String urlValue,String label) {
    if(!field.isBlank()&&!urlValue.isBlank()&&!field.equals(urlValue))throw new IllegalArgumentException(label+"与 JDBC 地址中的值不一致，请将两处配置为同一个名称，或清空独立字段以使用地址中的值");
    return field.isBlank()?urlValue:field;
  }
  private static String encode(String value) {return URLEncoder.encode(value,StandardCharsets.UTF_8).replace("+","%20");}
}
