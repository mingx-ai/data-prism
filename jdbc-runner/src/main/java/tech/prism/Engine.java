package tech.prism;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.sql.*;
import java.util.*;
import java.util.regex.*;
import java.util.function.BooleanSupplier;
import java.math.BigDecimal;
import java.nio.file.*;
import java.io.*;

/** Comparison engine: JDBC reads, bound variables, disk-backed joins, bounded evidence. */
public final class Engine {
  static final ObjectMapper J=Runner.JSON;
  static final Pattern VAR=Pattern.compile("\\$\\{([A-Za-z_]\\w*)}");
  static final Set<String> WRITE_WORDS=Set.of("INSERT","UPDATE","DELETE","DROP","ALTER","CREATE","TRUNCATE","MERGE","REPLACE","CALL","EXEC","EXECUTE","GRANT","REVOKE","INTO","OUTFILE","LOAD","COPY","SET");
  static final int PREVIEW=100, DIFF_LIMIT=1000;
  @FunctionalInterface interface AuditSink { void write(ObjectNode entry) throws Exception; }
  static final ThreadLocal<AuditSink> AUDIT=new ThreadLocal<>();
  static final ThreadLocal<ArrayNode> TRACE=new ThreadLocal<>();
  static void trace(JsonNode source,String operation,String sql,List<?> params){ArrayNode log=TRACE.get();if(log==null)return;ObjectNode event=log.addObject().put("sourceId",source.path("id").asText()).put("sourceName",source.path("name").asText()).put("operation",operation).put("sql",sql).put("at",Runner.now());event.set("parameters",J.valueToTree(params));}

  static void ignored(ObjectNode result,String key,String col,JsonNode a,JsonNode b,String reason,String rule,String ruleValue,String delta){
    result.put("ignoredCount",result.path("ignoredCount").asLong()+1);
    ObjectNode d=J.createObjectNode().put("key",key).put("column",col).put("reason",reason).put("rule",rule).put("ruleValue",ruleValue);
    d.set("baseline",a==null?NullNode.instance:a);d.set("target",b==null?NullNode.instance:b);if(delta!=null)d.put("delta",delta);
    ArrayNode details=result.withArray("ignoredDifferences");if(details.size()<DIFF_LIMIT)details.add(d);
    AuditSink sink=AUDIT.get();if(sink!=null)try{sink.write(d);}catch(Exception e){throw new IllegalStateException("忽略差异审计写入失败，不能将本次校验判定为通过",e);}
  }
  static void auditData(ObjectNode result,String key,String col,JsonNode a,JsonNode b,JsonNode strategy,JsonNode plan){
    Set<String> ignored=new LinkedHashSet<>();for(JsonNode value:strategy.path("ignoredValues"))ignored.add(resolve(value.asText(),plan));
    if(a.isNull()||b.isNull()||ignored.contains(a.asText())||ignored.contains(b.asText()))ignored(result,key,col,a,b,"特殊内容按 NULL 等价处理","null_equivalence",J.valueToTree(ignored).toString(),null);
    else if(strategy.path("ignoreJsonKeyOrder").asBoolean()&&JsonTolerance.equivalent(a,b))ignored(result,key,col,a,b,"JSON 内容一致，忽略键顺序及格式差异","json_key_order","ignoreJsonKeyOrder=true",null);
    else if(strategy.path("ignoreTimeDifference").asBoolean()&&TimeTolerance.delta(a.asText(),b.asText())!=null)ignored(result,key,col,a,b,"时间差未超过允许阈值（秒）","time_tolerance",resolve(strategy.path("timeToleranceSeconds").asText("1"),plan)+" 秒",TimeTolerance.delta(a.asText(),b.asText()).toPlainString());
    else ignored(result,key,col,a,b,"绝对误差未超过允许阈值","absolute_tolerance",resolve(strategy.path("tolerance").asText("0"),plan),new BigDecimal(a.asText()).subtract(new BigDecimal(b.asText())).abs().toPlainString());
  }

  record Query(String sql,List<Object> params){}
  static Connection connect(JsonNode s)throws Exception{try{return connectInternal(s);}catch(LinkageError e){throw new IllegalStateException("JDBC 驱动依赖不兼容，请检查 drivers 目录："+e.getClass().getSimpleName(),e);}}
  static Connection connectInternal(JsonNode s)throws Exception{
    String type=s.path("type").asText(),driver=s.path("driver").asText();
    String expected=switch(type){case "mysql"->"com.mysql.cj.jdbc.Driver";case "maxcompute"->"com.aliyun.odps.jdbc.OdpsDriver";case "lakehouse"->"com.clickzetta.client.jdbc.ClickZettaDriver";case "h2"->"org.h2.Driver";default->throw new IllegalArgumentException("不支持的数据源类型");};
    if(!driver.isEmpty()&&!driver.equals(expected))throw new IllegalArgumentException("驱动类与数据源类型不匹配");
    String prefix=switch(type){case "mysql"->"jdbc:mysql:";case "maxcompute"->"jdbc:odps:";case "lakehouse"->"jdbc:clickzetta:";default->"jdbc:h2:";};
    String url=s.path("jdbcUrl").asText();if(!url.startsWith(prefix))throw new IllegalArgumentException("JDBC URL 无效");
    if(type.equals("h2")&&!Boolean.getBoolean("prism.test"))throw new IllegalArgumentException("H2 仅供引擎集成测试");
    try{Class.forName(expected);}catch(ClassNotFoundException e){throw new IllegalArgumentException("缺少 JDBC 驱动："+expected+"；请将厂商驱动及依赖放入 drivers 目录");}
    JdbcSettings.Config config=JdbcSettings.from(s);
    DriverManager.setLoginTimeout(20);Connection c=DriverManager.getConnection(config.url(),config.properties());try{c.setReadOnly(true);}catch(SQLException ignored){}return c;
  }
  static ObjectNode describeTable(JsonNode request)throws Exception{
    JsonNode source=request.path("source");String schema=request.path("schema").asText(),name=request.path("table").asText();
    if(name.isBlank())throw new IllegalArgumentException("请先选择要读取结构的表");
    try(Connection c=connect(source)){ObjectNode result=J.createObjectNode().put("schema",schema).put("table",name);result.set("columns",columns(c,source,schema,name));return result;}
  }
  static ObjectNode catalog(JsonNode source)throws Exception{try(Connection c=connect(source)){return catalog(c,source);}}
  static ObjectNode catalog(Connection c,JsonNode source)throws Exception{
    ArrayNode tables=J.createArrayNode(),schemas=J.createArrayNode();DatabaseMetaData meta=c.getMetaData();
    String catalog=emptyNull(source.path("catalog").asText());boolean lakehouse=source.path("type").asText().equals("lakehouse"),maxcompute=source.path("type").asText().equals("maxcompute");
    boolean schemaNamespace=maxcompute&&maxComputeSchemaNamespace(c);String project=maxcompute?maxComputeProject(c,source,schemaNamespace):"";
    if(maxcompute)catalog=emptyNull(project);
    List<String> scopes=new ArrayList<>();
    if(lakehouse){
      if(catalog==null)catalog=emptyNull(Objects.toString(c.getCatalog(),""));
      if(catalog==null)throw new IllegalArgumentException("云器连接未指定 Workspace，请填写 Workspace 或在 JDBC 地址中指定");
      // ClickZetta 4.0.0 concatenates these arguments into SHOW SQL verbatim.
      // Quote identifiers here rather than supplying a wildcard/current namespace.
      try(ResultSet rs=meta.getSchemas(quote(catalog),null)){
        Set<String> seen=new LinkedHashSet<>();while(rs.next()){String schema=rs.getString("TABLE_SCHEM");if(schema!=null&&!schema.isBlank()&&!systemSchema(schema)&&seen.add(schema)){scopes.add(schema);schemas.add(schema);}}
      }
    }else scopes.add(null);
    Set<List<String>> seen=new HashSet<>();
    for(String scope:scopes){
      try(ResultSet rs=meta.getTables(lakehouse?quote(catalog):catalog,lakehouse?quote(scope):null,lakehouse?null:"%",new String[]{"TABLE","VIEW"})){
        while(rs.next()){
          String name=rs.getString("TABLE_NAME"),schema=lakehouse?scope:rs.getString("TABLE_SCHEM");
          if(schema==null)schema=source.path("type").asText().equals("mysql")?Objects.toString(rs.getString("TABLE_CAT"),""):source.path("schema").asText();
          if(name==null||systemSchema(schema))continue;
          String owner=lakehouse?catalog:Objects.toString(rs.getString("TABLE_CAT"),"");
          if(seen.add(List.of(owner,schema,name)))tables.addObject().put("name",name).put("schema",schema).put("catalog",owner);
        }
      }catch(SQLException error){if(!lakehouse)throw error;throw new SQLException("读取云器表目录失败：Workspace="+catalog+"，Schema="+scope+"；"+Runner.safeError(error),error.getSQLState(),error);}
    }
    ObjectNode result=J.createObjectNode();result.set("tables",tables);result.set("schemas",schemas);if(maxcompute)result.put("namespaceMode",schemaNamespace?"schema":"project").put("project",project);return result;
  }
  static boolean systemSchema(String schema){return Set.of("INFORMATION_SCHEMA","SYS","SYSTEM_SCHEMA").contains(schema.toUpperCase(Locale.ROOT));}
  static String emptyNull(String s){return s==null||s.isEmpty()?null:s;}
  static String quote(String name){if(name==null||name.isEmpty()||name.indexOf('\0')>=0)throw new IllegalArgumentException("表或字段名称为空");return "`"+name.replace("`","``")+"`";}
  static String table(String schema,String name){return (schema.isBlank()?"":quote(schema)+".")+quote(name);}
  static boolean maxComputeSchemaNamespace(Connection c)throws Exception{return (Boolean)c.getClass().getMethod("isOdpsNamespaceSchema").invoke(c);}
  static String maxComputeProject(Connection c,JsonNode source,boolean schemaNamespace)throws SQLException{String project=source.path("catalog").asText().trim();return project.isBlank()?Objects.toString(schemaNamespace?c.getCatalog():c.getSchema(),""):project;}
  static String qualified(Connection c,JsonNode source,String schema,String name)throws Exception{
    ExecutionProgress.use(c);
    String catalog=source.path("catalog").asText();
    if(source.path("type").asText().equals("maxcompute")){
      boolean enabled=maxComputeSchemaNamespace(c);
      catalog=maxComputeProject(c,source,enabled);
      if(enabled)return (catalog.isBlank()?"":quote(catalog)+".")+table(schema.isBlank()?Objects.toString(c.getSchema(),"default"):schema,name);
      // The legacy ODPS driver reports the project in TABLE_SCHEM, not a real schema.
      if(!schema.isBlank()&&!schema.equalsIgnoreCase("default")&&!schema.equals(catalog))throw new IllegalArgumentException("表映射仍使用命名空间「"+schema+"」，当前 MaxCompute 数据源为两层项目「"+catalog+"」（项目.表）；请刷新表目录，将映射更新到当前项目并保存测试计划后重试");
      return table(catalog,name);
    }
    if(source.path("type").asText().equals("lakehouse")&&!catalog.isBlank())return quote(catalog)+"."+table(schema,name);
    return table(schema,name);
  }
  static Query compileSql(String template,JsonNode plan,Connection c,JsonNode source,String schema,String name,int limit)throws Exception{ExecutionProgress.use(c);return compile(template,plan,schema,name,limit,qualified(c,source,schema,name));}
  static String identifier(String v){if(!v.matches("[A-Za-z_]\\w*"))throw new IllegalArgumentException("标识符变量无效："+v);return quote(v);}
  static Map<String,JsonNode> variables(JsonNode plan){Map<String,JsonNode> vars=new HashMap<>();for(JsonNode v:plan.path("variables")){String name=v.path("name").asText();if(vars.put(name,v)!=null)throw new IllegalArgumentException("重复变量："+name);}return vars;}
  static String resolve(String value,JsonNode plan){Matcher m=VAR.matcher(value);StringBuffer out=new StringBuffer();Map<String,JsonNode> vars=variables(plan);while(m.find()){JsonNode v=vars.get(m.group(1));if(v==null)throw new IllegalArgumentException("未定义变量："+m.group(1));m.appendReplacement(out,Matcher.quoteReplacement(v.path("value").asText()));}m.appendTail(out);return out.toString();}
  static Query compile(String template,JsonNode plan,String schema,String name,int limit){return compile(template,plan,schema,name,limit,table(schema,name));}
  static Query compile(String template,JsonNode plan,String schema,String name,int limit,String fullTable){
    Matcher matcher=VAR.matcher(template);StringBuffer out=new StringBuffer();List<Object> params=new ArrayList<>();Map<String,JsonNode> vars=variables(plan);
    while(matcher.find()){String n=matcher.group(1),replacement;if(n.equals("table"))replacement=fullTable;else if(n.equals("schema"))replacement=quote(schema);else if(n.equals("limit"))replacement=Integer.toString(limit);else{JsonNode v=vars.get(n);if(v==null)throw new IllegalArgumentException("未定义变量："+n);if(v.path("type").asText().equals("identifier"))replacement=identifier(v.path("value").asText());else{if(matcher.start()>0&&"'\"`".indexOf(template.charAt(matcher.start()-1))>=0)throw new IllegalArgumentException("值变量不要放在引号内：${"+n+"}");replacement="?";params.add(v.path("type").asText().equals("number")?new BigDecimal(v.path("value").asText()):v.path("value").asText());}}matcher.appendReplacement(out,Matcher.quoteReplacement(replacement));}matcher.appendTail(out);String sql=out.toString().trim();readOnly(sql);return new Query(sql,params);
  }
  static String stripLiterals(String sql){StringBuilder result=new StringBuilder();boolean quote=false;char end=0;for(int i=0;i<sql.length();i++){char c=sql.charAt(i);if(quote){if(c==end){if(i+1<sql.length()&&sql.charAt(i+1)==end){i++;}else quote=false;}else if(c=='\\'&&i+1<sql.length())i++;result.append(' ');continue;}if(c=='\''||c=='"'||c=='`'){quote=true;end=c;result.append(' ');continue;}if(c=='-'&&i+1<sql.length()&&sql.charAt(i+1)=='-'){while(i<sql.length()&&sql.charAt(i)!='\n')i++;result.append(' ');continue;}if(c=='/'&&i+1<sql.length()&&sql.charAt(i+1)=='*')throw new IllegalArgumentException("SQL 不支持块注释或可执行注释");result.append(c);}if(quote)throw new IllegalArgumentException("SQL 引号未闭合");return result.toString();}
  static void readOnly(String sql){String plain=stripLiterals(sql).trim().toUpperCase(Locale.ROOT);if(!plain.matches("(?s)^(SELECT|WITH)\\b.*"))throw new IllegalArgumentException("只允许单条 SELECT / WITH 查询");if(plain.contains(";"))throw new IllegalArgumentException("SQL 不允许多语句或分号");Matcher words=Pattern.compile("[A-Z_]+").matcher(plain);while(words.find())if(WRITE_WORDS.contains(words.group()))throw new IllegalArgumentException("SQL 包含非只读操作："+words.group());}
  static PreparedStatement statement(Connection c,Query q,JsonNode source)throws SQLException{ExecutionProgress.use(c);ExecutionProgress.emit("preparing_sql","准备 SQL 与绑定参数",q.sql,-1);trace(source,"SQL query attempt",q.sql,q.params);PreparedStatement st=c.prepareStatement(q.sql);int timeout=source.path("properties").path("queryTimeout").asInt(120);st.setQueryTimeout(Math.max(1,Math.min(timeout,3600)));try{st.setFetchSize(1000);}catch(SQLException ignored){}for(int i=0;i<q.params.size();i++)st.setObject(i+1,q.params.get(i));return st;}
  static ArrayNode columns(Connection c,JsonNode source,String schema,String table)throws Exception{return columns(c,source,schema,table,new ArrayList<>());}
  static ArrayNode columns(Connection c,JsonNode source,String schema,String table,List<String> trace)throws Exception{ExecutionProgress.use(c);if(source.path("type").asText().equals("maxcompute"))qualified(c,source,schema,table);ExecutionProgress.emit("metadata","读取表结构元数据："+schema+"."+table);trace.add("JDBC DatabaseMetaData.getColumns(catalog="+source.path("catalog").asText()+", schema="+schema+", table="+table+")");trace(source,"JDBC metadata attempt",trace.get(0),List.of());ArrayNode out=J.createArrayNode();try{DatabaseMetaData meta=c.getMetaData();String catalog=emptyNull(source.path("catalog").asText()),patternSchema=emptyNull(schema);if(source.path("type").asText().equals("mysql")){catalog=emptyNull(schema.isBlank()?source.path("catalog").asText():schema);patternSchema=null;}String escape=null;try{escape=meta.getSearchStringEscape();}catch(SQLException error){if(!(error instanceof SQLFeatureNotSupportedException)&&!"0A000".equals(error.getSQLState()))throw error;trace.add("JDBC search-pattern escaping unsupported; matching returned table names exactly");}String pattern=table;if(escape!=null&&!escape.isEmpty())pattern=table.replace(escape,escape+escape).replace("_",escape+"_").replace("%",escape+"%");try(ResultSet rs=meta.getColumns(catalog,patternSchema,pattern,"%")){while(rs.next()){if(!table.equals(rs.getString("TABLE_NAME")))continue;out.addObject().put("name",rs.getString("COLUMN_NAME")).put("type",normalizeType(rs.getString("TYPE_NAME"))).put("nullable",rs.getInt("NULLABLE")!=DatabaseMetaData.columnNoNulls).put("precision",rs.getInt("COLUMN_SIZE")).put("scale",rs.getInt("DECIMAL_DIGITS"));}}
    }catch(SQLException error){if(!(error instanceof SQLFeatureNotSupportedException)&&!"0A000".equals(error.getSQLState()))throw error;out.removeAll();trace.add("JDBC metadata unsupported: "+Runner.safeError(error));trace(source,"JDBC metadata unsupported",Runner.safeError(error),List.of());}
    if(out.isEmpty()){try(Statement st=c.createStatement()){st.setQueryTimeout(120);try(ResultSet rs=st.executeQuery(metadataFallback(c,source,schema,table,trace))){ResultSetMetaData m=rs.getMetaData();for(int i=1;i<=m.getColumnCount();i++)out.addObject().put("name",m.getColumnLabel(i)).put("type",normalizeType(m.getColumnTypeName(i))).put("nullable",m.isNullable(i)!=ResultSetMetaData.columnNoNulls).put("precision",m.getPrecision(i)).put("scale",m.getScale(i));}}}if(out.isEmpty())throw new SQLException("表不存在或没有权限："+table);return out;}
  static String metadataFallback(Connection c,JsonNode source,String schema,String name,List<String> trace)throws Exception{String sql="SELECT * FROM "+qualified(c,source,schema,name)+" WHERE 1 = 0";trace.add("Metadata fallback SQL: "+sql);trace(source,"SQL metadata fallback attempt",sql,List.of());ExecutionProgress.emit("metadata_query","通过 SQL 读取表结构，等待数据库返回",sql,-1);return sql;}
  static String normalizeType(String t){String n=t.toUpperCase(Locale.ROOT).replaceAll("\\(.*\\)","");return switch(n){case "INT8","LONG"->"BIGINT";case "INTEGER","INT4"->"INT";case "NUMERIC"->"DECIMAL";case "STRING","TEXT","CHARACTER VARYING"->"VARCHAR";default->n;};}
  // Integral types have no fractional digits; strings and approximate numerics do not
  // have a declared decimal scale. In particular ClickZetta 4.0.0 reports 1 for all
  // non-DECIMAL columns. Keep raw evidence, but do not turn it into a schema mismatch.
  static boolean scaleApplicable(String type){String t=normalizeType(type).trim();return t.equals("DECIMAL")||t.equals("TIME")||t.startsWith("TIME ")||t.startsWith("TIMESTAMP");}
  static List<String> columnNames(ArrayNode c){List<String> result=new ArrayList<>();for(JsonNode n:c)result.add(n.path("name").asText());return result;}
  static boolean has(List<String> cols,String name){return cols.stream().anyMatch(c->c.equalsIgnoreCase(name));}
  static String actual(List<String> cols,String name){return cols.stream().filter(c->c.equalsIgnoreCase(name)).findFirst().orElseThrow(()->new IllegalArgumentException("缺少字段："+name));}
  static List<String> parseFields(String value){if(value.isBlank())return List.of();List<String> fields=new ArrayList<>();for(String item:value.split(",")){String n=item.trim().replaceAll("(?i)\\s+(ASC|DESC)$","").replace("`","");if(!n.matches("[A-Za-z_][A-Za-z_0-9]*"))throw new IllegalArgumentException("字段列表格式无效："+item);fields.add(n);}return fields;}
  static String order(JsonNode strategy,JsonNode plan,List<String> a,List<String> b){String configured=resolve(strategy.path("order").asText(),plan);List<String> fields=parseFields(configured);if(!fields.isEmpty()&&fields.stream().allMatch(f->has(a,f)&&has(b,f)))return configured;throw new IllegalArgumentException("请在表级策略配置两边都存在的排序字段");}
  static List<String> keys(JsonNode s,JsonNode plan,String order,List<String> a,List<String> b){List<String> keys=parseFields(resolve(s.path("key").asText(),plan));if(keys.isEmpty())keys=parseFields(order);if(keys.stream().allMatch(f->has(a,f)&&has(b,f)))return keys;throw new IllegalArgumentException("数据对齐键字段不在两侧表中："+String.join(",",keys)+"；请配置两边共同的唯一键，显式对齐键不会被备用排序字段替换");}
  static String filter(Connection c,JsonNode source,JsonNode strategy,JsonNode plan,String schema,String name)throws Exception{String f=strategy.path("filter").asText();if(f.isBlank())return "";try{Query probe=compileSql("SELECT * FROM "+qualified(c,source,schema,name)+" WHERE ("+f+") AND 1 = 0",plan,c,source,schema,name,100);try(PreparedStatement st=statement(c,probe,source);ResultSet ignored=ExecutionProgress.query(st)){return f;}}catch(SQLException e){String state=Objects.toString(e.getSQLState(),"");String msg=Objects.toString(e.getMessage(),"").toLowerCase(Locale.ROOT);if(!(state.equals("42S22")||state.equals("42703")||msg.contains("column")&&(msg.contains("not found")||msg.contains("cannot be resolved")||msg.contains("invalid column")||msg.contains("does not exist"))))throw e;throw new IllegalArgumentException("表级筛选字段不存在："+Runner.safeError(e));}}
  static ObjectNode evidence(String sql,List<?> params,ArrayNode rows,long count,long started){ObjectNode o=J.createObjectNode();o.put("sql",sql);ObjectNode p=o.putObject("parameters");for(int i=0;i<params.size();i++)p.set(Integer.toString(i+1),J.valueToTree(params.get(i)));ArrayNode cols=o.putArray("columns");if(!rows.isEmpty())rows.get(0).fieldNames().forEachRemaining(cols::add);o.set("rows",rows);o.put("rowCount",Long.toString(count));o.put("capturedAt",Runner.now());o.put("durationMs",System.currentTimeMillis()-started);o.put("truncated",count>rows.size());return o;}
  static ObjectNode row(ResultSet rs)throws Exception{ObjectNode row=J.createObjectNode();ResultSetMetaData m=rs.getMetaData();Set<String> names=new HashSet<>();for(int i=1;i<=m.getColumnCount();i++){String name=m.getColumnLabel(i).toLowerCase(Locale.ROOT);if(!names.add(name))throw new IllegalArgumentException("SQL 返回重复列名，请使用唯一别名："+name);Object value=rs.getObject(i);if(value==null)row.putNull(name);else if(value instanceof byte[] bytes)row.put(name,Base64.getEncoder().encodeToString(bytes));else if(value instanceof Boolean b)row.put(name,b);else if(value instanceof Number)row.put(name,new BigDecimal(rs.getString(i)).stripTrailingZeros().toPlainString());else row.put(name,rs.getString(i));}return row;}
  static boolean positional(JsonNode strategy){String mode=strategy.path("alignment").asText("key");if(!Set.of("key","position").contains(mode))throw new IllegalArgumentException("数据对齐方式无效");return mode.equals("position");}
  static String positionKey(long row){String value=Long.toString(row);return "0".repeat(19-value.length())+value;}
  static String comparisonLabel(String key,boolean positional){return positional?"第 "+Long.parseLong(key)+" 行":key;}
  static boolean topLevelOrder(String sql){String plain=stripLiterals(sql);StringBuilder top=new StringBuilder();int depth=0;for(char ch:plain.toCharArray()){if(ch=='(')depth++;else if(ch==')')depth--;top.append(depth==0?ch:' ');}return Pattern.compile("(?is)\\bORDER\\s+BY\\b").matcher(top).find();}
  static String key(ObjectNode row,List<String> keys){ArrayNode arr=J.createArrayNode();for(String k:keys){JsonNode v=row.get(k.toLowerCase(Locale.ROOT));if(v==null)throw new IllegalArgumentException("查询结果缺少数据对齐键字段："+k+"；请在自定义 SQL 中返回该字段或使用同名别名");if(v.isNull())throw new IllegalArgumentException("数据对齐键包含 NULL："+k+"；请配置非空唯一键或复合键");arr.add(v.asText());}return arr.toString();}
  static boolean equal(JsonNode a,JsonNode b,JsonNode strategy,JsonNode plan,boolean numeric){if(Objects.equals(a,b))return true;Set<String> ignored=new HashSet<>();for(JsonNode n:strategy.path("ignoredValues"))ignored.add(resolve(n.asText(),plan));boolean an=a==null||a.isNull()||ignored.contains(a.asText()),bn=b==null||b.isNull()||ignored.contains(b.asText());if(an||bn)return an&&bn;if(strategy.path("ignoreJsonKeyOrder").asBoolean()&&JsonTolerance.equivalent(a,b))return true;if(numeric&&strategy.path("ignorePrecision").asBoolean())try{return new BigDecimal(a.asText()).subtract(new BigDecimal(b.asText())).abs().compareTo(new BigDecimal(resolve(strategy.path("tolerance").asText("0"),plan)))<=0;}catch(NumberFormatException ignoredEx){}if(strategy.path("ignoreTimeDifference").asBoolean()&&a.isTextual()&&b.isTextual()){BigDecimal delta=TimeTolerance.delta(a.asText(),b.asText());if(delta!=null)return delta.compareTo(new BigDecimal(resolve(strategy.path("timeToleranceSeconds").asText("1"),plan)))<=0;}return false;}
  static void diff(ObjectNode result,String key,String col,JsonNode a,JsonNode b,String reason){result.put("differenceCount",result.path("differenceCount").asLong()+1);ArrayNode diffs=result.withArray("differences");if(diffs.size()<DIFF_LIMIT){ObjectNode d=diffs.addObject();d.put("key",key).put("column",col).put("reason",reason);d.set("baseline",a==null?NullNode.instance:a);d.set("target",b==null?NullNode.instance:b);}}
  static void schemaNote(ObjectNode result,String name,String prop,JsonNode a,JsonNode b,String reason){
    result.put("schemaNoteCount",result.path("schemaNoteCount").asLong()+1);
    ArrayNode notes=result.withArray("schemaNotes");
    if(notes.size()<DIFF_LIMIT){ObjectNode n=notes.addObject().put("key",name).put("column",prop).put("reason",reason);n.set("baseline",a);n.set("target",b);}
  }
  static void rowDifference(ObjectNode result,String key,JsonNode left,JsonNode right,List<String> changed,String reason){
    result.put("differentRowCount",result.path("differentRowCount").asLong()+1);
    ArrayNode rows=result.withArray("rowDifferences");
    if(rows.size()<PREVIEW){ObjectNode row=rows.addObject().put("key",key).put("reason",reason);row.set("baseline",left==null?NullNode.instance:left);row.set("target",right==null?NullNode.instance:right);row.set("changedColumns",J.valueToTree(changed));}
  }
  static ArrayNode schemaSql(Connection c,JsonNode source,String custom,JsonNode plan,String schema,String name)throws Exception{Query q=compileSql(custom,plan,c,source,schema,name,100);ArrayNode rows=J.createArrayNode();try(PreparedStatement st=statement(c,q,source);ResultSet rs=ExecutionProgress.query(st)){while(rs.next()){ObjectNode raw=row(rs),r=J.createObjectNode();for(String k:List.of("name","type","nullable","precision","scale"))if(!raw.hasNonNull(k))throw new IllegalArgumentException("结构 SQL 缺少列："+k);r.put("name",raw.path("name").asText());r.put("type",normalizeType(raw.path("type").asText()));r.put("nullable",Set.of("true","1","yes").contains(raw.path("nullable").asText().toLowerCase(Locale.ROOT)));r.put("precision",raw.path("precision").asInt());r.put("scale",raw.path("scale").asInt());rows.add(r);if(rows.size()>10000)throw new IllegalArgumentException("结构 SQL 返回超过 10000 个字段");}}return rows;}
  static JsonNode effectiveStrategy(JsonNode plan,JsonNode mapping,JsonNode local){
    ObjectNode merged=plan.path("strategy").deepCopy();merged.remove("specified");
    merged.put("filter","").put("order","").put("alignment","position").put("key","").put("fallbackFilter","").put("fallbackOrder","");
    if(!mapping.path("override").asBoolean())return merged;
    if(!local.has("specified")&&!local.has("alignment"))merged.put("alignment","key");
    List<String> paths=new ArrayList<>(List.of("dimensions","mode","alignment","limit","ignorePrecision","tolerance","ignoreJsonKeyOrder","ignoreTimeDifference","timeToleranceSeconds","ignoredValues","ignoredColumns","filter","order","key"));
    for(String dimension:List.of("schema","count","data"))for(String side:List.of("baseline","target"))paths.add("sql."+dimension+"."+side);
    for(String path:paths){
      if(local.has("specified")){boolean selected=false;for(JsonNode field:local.path("specified"))if(field.asText().equals(path))selected=true;if(!selected)continue;}
      String[] keys=path.split("\\.");JsonNode value=local;for(String key:keys)value=value.path(key);
      if(value.isMissingNode()||value.isNull()||value.isTextual()&&value.asText().isBlank()||value.isArray()&&value.isEmpty())continue;
      ObjectNode node=merged;for(int i=0;i<keys.length-1;i++){if(!node.path(keys[i]).isObject())node.putObject(keys[i]);node=(ObjectNode)node.get(keys[i]);}node.set(keys[keys.length-1],value.deepCopy());
    }
    return merged;
  }
  static ObjectNode compare(JsonNode plan,JsonNode group,JsonNode m,JsonNode strategy,String dimension,JsonNode a,JsonNode b,BooleanSupplier cancelled){strategy=effectiveStrategy(plan,m,m.path("strategy"));long start=System.currentTimeMillis();ObjectNode r=J.createObjectNode();r.put("id",m.path("id").asText()+":"+dimension).put("groupId",group.path("id").asText()).put("baselineName",a.path("name").asText()).put("targetName",b.path("name").asText()).put("dimension",dimension).put("status","passed").put("differenceCount",0).put("ignoredCount",0);for(String k:List.of("baselineTable","baselineSchema","targetTable","targetSchema"))r.set(k,m.path(k));r.set("strategy",strategy.deepCopy());r.putArray("differences");r.putArray("ignoredDifferences");TRACE.set(r.putArray("executionTrace"));
    String as=m.path("baselineSchema").asText(),at=m.path("baselineTable").asText(),bs=m.path("targetSchema").asText(),bt=m.path("targetTable").asText();
    try(Connection ca=ExecutionProgress.connect(a,"baseline");Connection cb=ExecutionProgress.connect(b,"target")){
      if(strategy.path("ignoreTimeDifference").asBoolean()&&new BigDecimal(resolve(strategy.path("timeToleranceSeconds").asText("1"),plan)).signum()<0)throw new IllegalArgumentException("时间差阈值必须为非负秒数");
      String ac=strategy.path("sql").path(dimension).path("baseline").asText(),bc=strategy.path("sql").path(dimension).path("target").asText();
      if(dimension.equals("schema")){List<String> traceA=new ArrayList<>(),traceB=new ArrayList<>();ArrayNode la=ac.isBlank()?columns(ca,a,as,at,traceA):schemaSql(ca,a,ac,plan,as,at),lb=bc.isBlank()?columns(cb,b,bs,bt,traceB):schemaSql(cb,b,bc,plan,bs,bt);r.set("baseline",evidence(ac.isBlank()?String.join("\n",traceA):compileSql(ac,plan,ca,a,as,at,100).sql,ac.isBlank()?List.of():compileSql(ac,plan,ca,a,as,at,100).params,la,la.size(),start));r.set("target",evidence(bc.isBlank()?String.join("\n",traceB):compileSql(bc,plan,cb,b,bs,bt,100).sql,bc.isBlank()?List.of():compileSql(bc,plan,cb,b,bs,bt,100).params,lb,lb.size(),start));ExecutionProgress.local("comparing_schema","正在对比两侧表结构");Map<String,JsonNode> left=new LinkedHashMap<>(),right=new LinkedHashMap<>();for(JsonNode c:la)left.put(c.path("name").asText().toLowerCase(Locale.ROOT),c);for(JsonNode c:lb)right.put(c.path("name").asText().toLowerCase(Locale.ROOT),c);Set<String> names=new LinkedHashSet<>(left.keySet());names.addAll(right.keySet());for(String name:names){JsonNode l=left.get(name),rr=right.get(name);if(l==null||rr==null){diff(r,name,"字段",l,rr,"一侧缺少字段");continue;}for(String prop:List.of("type","nullable","precision","scale")){if(Objects.equals(l.get(prop),rr.get(prop)))continue;if(prop.equals("scale")&&!scaleApplicable(l.path("type").asText())&&!scaleApplicable(rr.path("type").asText())){schemaNote(r,name,prop,l.get(prop),rr.get(prop),l.path("type").asText()+" / "+rr.path("type").asText()+" 不比较 scale；驱动原始值仅供核查，不计入差异或策略忽略");continue;}if(strategy.path("ignorePrecision").asBoolean()&&Set.of("precision","scale").contains(prop)&&Set.of("DECIMAL","FLOAT","DOUBLE","REAL").contains(l.path("type").asText())){ignored(r,name,prop,l.get(prop),rr.get(prop),"数值字段精度 / 小数位变化按策略忽略","schema_precision","ignorePrecision=true",null);continue;}diff(r,name,prop,l.get(prop),rr.get(prop),"字段属性不一致");}}r.put("summary","基准 "+la.size()+" 个字段 / 目标 "+lb.size()+" 个字段");
      }else{
        String af=ac.isBlank()?filter(ca,a,strategy,plan,as,at):"",bf=bc.isBlank()?filter(cb,b,strategy,plan,bs,bt):"";String abase="SELECT * FROM "+qualified(ca,a,as,at)+(af.isBlank()?"":" WHERE "+af),bbase="SELECT * FROM "+qualified(cb,b,bs,bt)+(bf.isBlank()?"":" WHERE "+bf);
        if(dimension.equals("count")){Query aq=compileSql(ac.isBlank()?abase.replace("SELECT *","SELECT COUNT(*) AS count"):ac,plan,ca,a,as,at,100),bq=compileSql(bc.isBlank()?bbase.replace("SELECT *","SELECT COUNT(*) AS count"):bc,plan,cb,b,bs,bt,100);ArrayNode la=J.createArrayNode(),lb=J.createArrayNode();r.set("baseline",evidence(aq.sql,aq.params,la,0,start));r.set("target",evidence(bq.sql,bq.params,lb,0,start));BigDecimal l=count(ca,a,aq);la.addObject().put("count",l.toPlainString());r.set("baseline",evidence(aq.sql,aq.params,la,1,start));BigDecimal rr=count(cb,b,bq);lb.addObject().put("count",rr.toPlainString());r.set("target",evidence(bq.sql,bq.params,lb,1,start));ExecutionProgress.local("comparing_count","正在对比两侧行数");if(l.compareTo(rr)!=0)diff(r,"count","count",la.get(0).get("count"),lb.get(0).get("count"),"行数不一致");r.put("summary","基准 "+l.toPlainString()+" 行 / 目标 "+rr.toPlainString()+" 行");
        }else if(dimension.equals("data")){boolean full=strategy.path("mode").asText().equals("full");int limit=full?10000:Integer.parseInt(resolve(strategy.path("limit").asText("100"),plan));if(!full&&(limit<1||limit>10000))throw new IllegalArgumentException("抽样行数必须为 1–10000");boolean positional=positional(strategy);String order="";List<String> keys=List.of();if(!positional||ac.isBlank()||bc.isBlank()){List<String> lcols=columnNames(columns(ca,a,as,at)),rcols=columnNames(columns(cb,b,bs,bt));order=order(strategy,plan,lcols,rcols);if(!positional)keys=keys(strategy,plan,order,lcols,rcols);}r.put("alignmentMode",positional?"position":"key");r.set("alignmentKeys",J.valueToTree(keys));r.put("alignmentKeySource",positional?"position":strategy.path("key").asText().isBlank()?"order":"explicit");
          String aquery=ac.isBlank()?abase+" ORDER BY "+order+(full?"":" LIMIT "+limit):ac,bquery=bc.isBlank()?bbase+" ORDER BY "+order+(full?"":" LIMIT "+limit):bc;
          if((positional||!full)&&((!ac.isBlank()&&!topLevelOrder(ac))||(!bc.isBlank()&&!topLevelOrder(bc))))throw new IllegalArgumentException("按排序位置对比或抽样时，自定义 SQL 必须在最外层显式包含 ORDER BY");
          Query aq=compileSql(aquery,plan,ca,a,as,at,limit),bq=compileSql(bquery,plan,cb,b,bs,bt,limit);compareData(r,ca,cb,a,b,aq,bq,keys,strategy,plan,full,limit,cancelled,start);r.put("summary",(positional?"按排序位置逐条对比；":"按唯一键对齐；")+"已核对基准 "+r.path("baseline").path("rowCount").asText()+" 行 / 目标 "+r.path("target").path("rowCount").asText()+" 行；差异 "+r.path("differenceCount").asLong()+" 处");
        }else throw new IllegalArgumentException("校验维度无效");
      }
      if(r.path("differenceCount").asLong()>0)r.put("status","different");ExecutionProgress.local("closing","释放 JDBC 连接");
    }catch(Exception e){ExecutionProgress.emit("error","校验失败："+Runner.safeError(e));r.put("status","error");r.put("error",Runner.safeError(e));r.put("summary",Runner.safeError(e));}r.put("durationMs",System.currentTimeMillis()-start);TRACE.remove();return r;
  }
  static BigDecimal count(Connection c,JsonNode source,Query q)throws Exception{try(PreparedStatement st=statement(c,q,source);ResultSet rs=ExecutionProgress.query(st)){if(rs.getMetaData().getColumnCount()!=1||!rs.next())throw new IllegalArgumentException("行数 SQL 必须返回一行一列");String raw=rs.getString(1);BigDecimal n;try{n=raw==null?null:new BigDecimal(raw.trim());}catch(NumberFormatException error){throw new IllegalArgumentException("行数 SQL 必须返回一个非负整数",error);}if(n==null||n.signum()<0||n.stripTrailingZeros().scale()>0||rs.next())throw new IllegalArgumentException("行数 SQL 必须返回一个非负整数");return n;}}
  static void compareData(ObjectNode r,Connection a,Connection b,JsonNode sa,JsonNode sb,Query aq,Query bq,List<String> keys,JsonNode strategy,JsonNode plan,boolean full,int limit,BooleanSupplier cancelled,long started)throws Exception{
    ExecutionProgress.local("spooling","准备本地数据对齐缓存");Set<String> excluded=new HashSet<>();for(JsonNode field:strategy.path("ignoredColumns"))excluded.add(field.asText().toLowerCase(Locale.ROOT));boolean positional=positional(strategy);Set<String> numericFields=new HashSet<>();Path dir=Files.createTempDirectory("prism-compare-");try(Connection spool=DriverManager.getConnection("jdbc:h2:file:"+dir.resolve("rows")+";DB_CLOSE_ON_EXIT=FALSE;CACHE_SIZE=8192;MAX_MEMORY_ROWS=1000")){try(Statement st=spool.createStatement()){st.execute("CREATE TABLE records (side INT, k VARCHAR, payload CLOB, PRIMARY KEY(side,k))");}spool.setAutoCommit(false);
      for(int side=0;side<2;side++){Connection source=side==0?a:b;JsonNode config=side==0?sa:sb;Query q=side==0?aq:bq;String context=(side==0?"基准侧":"目标侧")+" ["+config.path("name").asText()+"] 表 "+r.path(side==0?"baselineTable":"targetTable").asText()+"，对齐键 ("+String.join(",",keys)+")"+(strategy.path("key").asText().isBlank()?"（未填写对齐键，沿用排序字段）":"");r.set(side==0?"baseline":"target",evidence(q.sql,q.params,J.createArrayNode(),0,started));BigDecimal expected=full?count(source,config,new Query("SELECT COUNT(*) FROM ("+q.sql+") prism_full_count",q.params)):null;long count=0;ArrayNode preview=J.createArrayNode();ObjectNode evidence=evidence(q.sql,q.params,preview,0,started);r.set(side==0?"baseline":"target",evidence);
        try(PreparedStatement st=statement(source,q,config);ResultSet rs=ExecutionProgress.query(st);PreparedStatement insert=spool.prepareStatement("INSERT INTO records(side,k,payload) VALUES (?,?,?)")){
          Set<String> numericSide=new HashSet<>();ResultSetMetaData meta=rs.getMetaData();for(int ci=1;ci<=meta.getColumnCount();ci++)if(Set.of(Types.BIGINT,Types.INTEGER,Types.SMALLINT,Types.TINYINT,Types.NUMERIC,Types.DECIMAL,Types.FLOAT,Types.REAL,Types.DOUBLE).contains(meta.getColumnType(ci)))numericSide.add(meta.getColumnLabel(ci).toLowerCase(Locale.ROOT));if(side==0)numericFields.addAll(numericSide);else numericFields.retainAll(numericSide);
          while(rs.next()){if(cancelled.getAsBoolean()){try{st.cancel();}catch(SQLException ignored){}throw new InterruptedException("执行已取消");}count++;if(!full&&count>limit)throw new IllegalArgumentException("自定义 SQL 返回超过指定抽样行数，请使用 LIMIT ${limit}");ObjectNode row=row(rs);if(preview.size()<PREVIEW)preview.add(row);String k;try{k=positional?positionKey(count):key(row,keys);}catch(IllegalArgumentException error){throw new IllegalArgumentException(context+"，查询结果第 "+count+" 行："+error.getMessage(),error);}insert.setInt(1,side);insert.setString(2,k);insert.setString(3,row.toString());try{insert.executeUpdate();}catch(SQLException e){if(e.getSQLState()!=null&&e.getSQLState().startsWith("23"))throw new IllegalArgumentException(context+"，查询结果第 "+count+" 行：数据对齐键不唯一："+k+"；排序字段允许重复，但对齐键必须非空且唯一，请配置业务唯一键或逗号分隔的复合键");throw e;}if(count%1000==0)spool.commit();ExecutionProgress.rows("reading","读取查询结果并写入本地缓存",count,false);}spool.commit();ExecutionProgress.rows("read_complete","查询结果读取完成",count,true);
        }finally{r.set(side==0?"baseline":"target",evidence(q.sql,q.params,preview,count,started));}
        if(full&&expected.compareTo(BigDecimal.valueOf(count))!=0)throw new IllegalArgumentException("全量结果不完整或源表在执行期间变化：COUNT(*)="+expected+"，JDBC 实际返回="+count+"。请检查下载限制与数据稳定性。");
      }
      ExecutionProgress.local("comparing_data","按对齐规则逐行比较数据");long compared=0;r.putArray("rowDifferences");r.put("differentRowCount",0);
      try(PreparedStatement ls=spool.prepareStatement("SELECT k,payload FROM records WHERE side=0 ORDER BY k");PreparedStatement rs=spool.prepareStatement("SELECT k,payload FROM records WHERE side=1 ORDER BY k");ResultSet l=ls.executeQuery();ResultSet rr=rs.executeQuery()){
        boolean hasL=l.next(),hasR=rr.next();
        while(hasL||hasR){
          if(cancelled.getAsBoolean())throw new InterruptedException("执行已取消");
          int cmp=!hasL?1:!hasR?-1:l.getString(1).compareTo(rr.getString(1));
          String label=comparisonLabel(cmp<=0?l.getString(1):rr.getString(1),positional);
          JsonNode left=cmp<=0?J.readTree(l.getString(2)):null,right=cmp>=0?J.readTree(rr.getString(2)):null;
          Set<String> fields=new LinkedHashSet<>();if(left!=null)left.fieldNames().forEachRemaining(fields::add);if(right!=null)right.fieldNames().forEachRemaining(fields::add);
          if(cmp!=0){String reason=cmp<0?"目标缺少记录":"基准缺少记录";diff(r,label,"整行",left,right,reason);rowDifference(r,label,left,right,new ArrayList<>(fields),reason);}
          else{
            List<String> changed=new ArrayList<>();
            for(String field:fields){
              JsonNode lv=left.get(field),rv=right.get(field);
              if(excluded.contains(field.toLowerCase(Locale.ROOT))){if(!Objects.equals(lv,rv))ignored(r,label,field,lv,rv,"字段按配置跳过数据值对比","excluded_column",field,null);continue;}
              if(lv==null||rv==null){diff(r,label,field,lv,rv,"结果字段缺失");changed.add(field);continue;}
              if(!equal(lv,rv,strategy,plan,numericFields.contains(field))){diff(r,label,field,lv,rv,"字段值不一致");changed.add(field);}
              else if(!Objects.equals(lv,rv))auditData(r,label,field,lv,rv,strategy,plan);
            }
            if(!changed.isEmpty())rowDifference(r,label,left,right,changed,"字段值不一致");
          }
          compared++;ExecutionProgress.rows("comparing_data","按对齐规则逐行比较数据",compared,false);if(cmp<=0)hasL=l.next();if(cmp>=0)hasR=rr.next();
        }
        ExecutionProgress.rows("compared","数据逐行比较完成",compared,true);
      }
    }catch(Exception e){ExecutionProgress.emit("error","数据处理失败："+Runner.safeError(e));throw e;}finally{ExecutionProgress.local("cleanup","清理本地数据对齐缓存");try(var files=Files.walk(dir)){for(Path file:files.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(file);}}
  }
}
