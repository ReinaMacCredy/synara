import contextlib
import io
import json
import sys
import traceback

state = {"__builtins__": __builtins__}

for raw_line in sys.stdin:
    request = None
    try:
        request = json.loads(raw_line)
        local_scope = {"state": state, "input": request.get("input"), "result": None}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exec(request["code"], state, local_scope)
        response = {
            "id": request["id"],
            "ok": True,
            "result": local_scope.get("result"),
            "stdout": output.getvalue(),
        }
    except Exception as error:
        response = {
            "id": request.get("id", "unknown") if isinstance(request, dict) else "unknown",
            "ok": False,
            "error": str(error),
            "trace": traceback.format_exc(limit=4),
        }
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
    sys.stdout.flush()
