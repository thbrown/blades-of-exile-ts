// Prints the disassembly of the function at (or containing) an address.
// Usage: -postScript Disasm.java <seg:off> <out.txt>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;

public class Disasm extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs();
    Function f = getFunctionContaining(toAddr(a[0]));
    try (PrintWriter w = new PrintWriter(new FileWriter(a[1]))) {
      w.println("// " + f.getName());
      for (Instruction i : currentProgram.getListing().getInstructions(f.getBody(), true)) {
        w.println(i.getAddress() + "  " + i);
      }
    }
  }
}
