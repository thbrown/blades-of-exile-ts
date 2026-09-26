// Prints the disassembly of every function in the given segments, in address
// order, each headed by its name: a greppable listing of, say, all the town
// scripts (1078, 1088, 10b8) or the zone scripts (10a0, 10a8).
// Usage: -postScript DisasmSeg.java <out.txt> <seg> [seg...]
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;
import java.util.*;

public class DisasmSeg extends GhidraScript {
  public void run() throws Exception {
    String[] a = getScriptArgs();
    Set<String> segs = new HashSet<>(Arrays.asList(a).subList(1, a.length));
    try (PrintWriter w = new PrintWriter(new FileWriter(a[0]))) {
      for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
        String at = f.getEntryPoint().toString();
        if (!segs.contains(at.substring(0, 4))) continue;
        w.println("// ==== " + f.getName() + " @ " + at);
        for (Instruction i : currentProgram.getListing().getInstructions(f.getBody(), true)) {
          w.println(i.getAddress() + "  " + i);
        }
      }
    }
  }
}
