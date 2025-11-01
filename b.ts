// uaf_single_run.ts
// deno run -A --unstable-ffi uaf_single_run.ts
import { Python } from "jsr:@denosaurs/python";

const py = new Python();

// Run a single module that:
// - creates `obj`
// - defines accessors `get_obj()` and `get_obj_item(i)`
// - schedules deletion of `obj` in 1 second
// The runModule returns a proxy 'mod' with those functions we can call from JS.
const mod = py.runModule(`
import threading, time

# create object to be accessed from JS
obj = [42, 43, 44]

def get_obj():
    # return whole object (may raise if obj no longer exists)
    return obj

def get_obj_item(i):
    # return a single element (may raise if obj no longer exists)
    return obj[i]

def schedule_delete(delay_seconds=1.0):
    def do_delete():
        global obj
        print("[python] deleting obj now")
        try:
            del obj
        except Exception as e:
            print("[python] delete error:", e)
    t = threading.Timer(delay_seconds, do_delete)
    t.daemon = True
    t.start()
    return t

# schedule deletion after 1 second
schedule_delete(1.0)

# return a simple marker value (runModule will return module's last expression value,
# but many bridges actually return a module proxy — adjust if yours returns data)
"module_ready"
`);

console.log("module loaded; calling before-delete access:");

// Access before deletion (should work)
try {
  const before = mod.get_obj_item(0);
  console.log(
    "before-delete get_obj_item(0):",
    before && before.toString ? before.toString() : before,
  );
} catch (e) {
  console.error("before-delete error:", e);
}

// wait >1s so Python's background timer deletes obj
await new Promise((r) => setTimeout(r, 1500));

console.log("calling after deletion...");

try {
  // This will call into Python; if `obj` was deleted it will raise (NameError),
  // or — in a buggy bridge that reuses freed pointers — could produce a crash.
  const after = mod.get_obj_item(0);
  console.log("after-delete get_obj_item(0):", after && after.toString ? after.toString() : after);
} catch (e) {
  console.error("after-delete error (expected if obj was removed):", e);
}
