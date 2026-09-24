// Prints the disassembly of the function at (or containing) an address, or,
// given a count, that many instructions straight from the address. The second
// form reaches code auto-analysis never did: the arms of a jump table Ghidra
// could not recover, for one.
// Usage: -postScript Disasm.java <seg:off> <out.txt> [count]
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class Disasm extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs();
    Address at = toAddr(a[0]);
    try (PrintWriter w = new PrintWriter(new FileWriter(a[1]))) {
      if (a.length > 2) {
        int n = Integer.parseInt(a[2]);
        disassemble(at);
        Instruction i = getInstructionAt(at);
        for (int k = 0; k < n && i != null; k++) {
          w.println(i.getAddress() + "  " + i);
          Address next = i.getMaxAddress().add(1);
          if (getInstructionAt(next) == null) disassemble(next);
          i = getInstructionAt(next);
        }
        return;
      }
      Function f = getFunctionContaining(at);
      w.println("// " + f.getName());
      for (Instruction i : currentProgram.getListing().getInstructions(f.getBody(), true)) {
        w.println(i.getAddress() + "  " + i);
      }
    }
  }
}
