package tech.prism;
import java.math.BigDecimal;
import java.time.*;
import java.util.regex.*;
final class TimeTolerance {
  private static final Pattern TIME=Pattern.compile("^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(Z|[+-]\\d{2}:\\d{2})?$");
  static BigDecimal delta(String left,String right){
    Matcher a=TIME.matcher(left),b=TIME.matcher(right);
    if(!a.matches()||!b.matches()||(a.group(1)==null)!=(b.group(1)==null))return null;
    try{
      String l=left.replace(' ','T'),r=right.replace(' ','T');
      Instant x=a.group(1)==null?LocalDateTime.parse(l).toInstant(ZoneOffset.UTC):OffsetDateTime.parse(l).toInstant();
      Instant y=b.group(1)==null?LocalDateTime.parse(r).toInstant(ZoneOffset.UTC):OffsetDateTime.parse(r).toInstant();
      Duration d=Duration.between(x,y);
      return BigDecimal.valueOf(d.getSeconds()).add(BigDecimal.valueOf(d.getNano(),9)).abs().stripTrailingZeros();
    }catch(DateTimeException e){return null;}
  }
}
