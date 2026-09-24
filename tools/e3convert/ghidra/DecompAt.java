import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
public class DecompAt extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs();
    byte[] pat = new byte[a[0].length()/2];
    for (int i=0;i<pat.length;i++) pat[i]=(byte)Integer.parseInt(a[0].substring(2*i,2*i+2),16);
    println("functions: "+currentProgram.getFunctionManager().getFunctionCount());
    Address hit = currentProgram.getMemory().findBytes(currentProgram.getMinAddress(), pat, null, true, monitor);
    println("hit "+hit);
    Function f = getFunctionContaining(hit);
    if (f == null) {
      byte[] pro = {(byte)0x45,(byte)0x55,(byte)0x8b,(byte)0xec};
      Address st = currentProgram.getMemory().findBytes(hit, pro, null, false, monitor);
      Address fs = st.subtract(3); // 8c d0 90 (mov ax,ss; nop) precedes inc bp in win16 far prologue
      println("prologue at "+st+" bytes before: "+getByte(fs)+" "+getByte(fs.add(1))+" "+getByte(fs.add(2)));
      if (getByte(fs)!=(byte)0x8c) fs = st;
      disassemble(fs);
      f = createFunction(fs, null);
      if (f == null) f = getFunctionContaining(hit);
    }
    println("func "+f+" body "+f.getBody().getNumAddresses());
    DecompInterface di = new DecompInterface(); di.openProgram(currentProgram);
    DecompileResults r = di.decompileFunction(f, 120, monitor);
    java.nio.file.Files.writeString(java.nio.file.Path.of(a[1]), r.getDecompiledFunction().getC());
  }
}
