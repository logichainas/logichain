// nora-email-intake
// Power Automate → (this function) → Anthropic Files API → Nora session that STARTS ANALYSING immediately.
//
// - The session is created with `initial_events`, so Nora starts analysing immediately.
// - Step 2: every file is registered in `analysis_runs` (status "analysing"); the
//   `agent-webhook` function takes over when Nora goes idle (report → Planner → approval).

const AGENT_ID = Deno.env.get("NORA_AGENT_ID") ?? "agent_01A2ZdeQW8qG1GDahdGQpqto";
const ENVIRONMENT_ID = Deno.env.get("NORA_ENVIRONMENT_ID") ?? "env_01JRRjqD3KBCcjH2iiwkYbdR";
const MOUNT_PATH = "/data.xlsx";                       // Anthropic mounts this at …
const FILE_LOCATION = "/mnt/session/uploads/data.xlsx"; // … this path inside the session
const REPORT_PATH = "/mnt/session/outputs/nora_report.xlsx";

const UPLOAD_TIMEOUT_MS = 45_000;
const SESSION_TIMEOUT_MS = 30_000;

// ---------- helpers ----------
function log(level: "info" | "warn" | "error", requestId: string, stage: string, data: Record<string, unknown> = {}) {
  // Structured logs (visible in Supabase → Edge Functions → nora-email-intake → Logs).
  // Never log file contents or secrets.
  const line = JSON.stringify({ level, fn: "nora-email-intake", requestId, stage, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

class TimeoutError extends Error {
  constructor(public stage: string, public ms: number) {
    super(`${stage} timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

async function fetchWithTimeout(stage: string, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new TimeoutError(stage, ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Read an upstream error safely (status + Anthropic error type/message, truncated)
async function upstreamError(res: Response) {
  const text = await res.text().catch(() => "");
  let type: string | undefined, message: string | undefined;
  try {
    const j = JSON.parse(text);
    type = j?.error?.type;
    message = j?.error?.message;
  } catch (_) { /* not JSON */ }
  return {
    upstreamStatus: res.status,
    upstreamType: type,
    upstreamMessage: (message ?? text).slice(0, 500),
    upstreamRequestId: res.headers.get("request-id") ?? undefined,
  };
}

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const optStr = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function analysisPrompt(fileName: string, meta: { sender?: string; subject?: string; receivedAt?: string }) {
  const lines = [
    "A new procurement Excel file has arrived by email at nora@logichain.no and needs analysis.",
    "",
    `File name: ${fileName}`,
    `File location in your workspace: ${FILE_LOCATION} (read-only)`,
  ];
  if (meta.sender) lines.push(`Sent by: ${meta.sender}`);
  if (meta.subject) lines.push(`Email subject: ${meta.subject}`);
  if (meta.receivedAt) lines.push(`Received: ${meta.receivedAt}`);
  lines.push(
    "",
    "Open the file and run your standard Logichain procurement analysis as described in your instructions.",
    "Analyse only the purchasing data. If the workbook contains answer keys, solutions or sheets marked as hidden from the analyst, do not open or use them, and mention that they were present.",
    "",
    "DELIVERABLE (required): save your complete report as an Excel workbook at",
    `  ${REPORT_PATH}`,
    "with these sheets: Summary (key figures incl. savings_low_nok and savings_high_nok, and 3-5 headline findings),",
    "Findings, Actions (title, detail, priority high/medium/low), Data_Quality, Supplier_Prices, and Spend_Breakdown.",
    "You may also save a Markdown version next to it. The Excel file is picked up automatically by the next agent.",
    "Do not write anything to customer databases or external systems.",
  );
  return lines.join("\n");
}

// Register the run in Supabase (service role). Never fails the request.
async function registerRun(requestId: string, row: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { log("warn", requestId, "register_run", { result: "no_service_role" }); return; }
  try {
    const r = await fetchWithTimeout("register_run", `${url}/rest/v1/analysis_runs`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    }, 8_000);
    if (!r.ok) log("warn", requestId, "register_run", { status: r.status, body: (await r.text()).slice(0, 300) });
    else log("info", requestId, "register_run", { result: "ok" });
  } catch (e) {
    log("warn", requestId, "register_run", { result: "exception", errorMessage: e instanceof Error ? e.message : String(e) });
  }
}

// ---------- handler ----------
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const t0 = Date.now();

  const expectedToken = Deno.env.get("NORA_WEBHOOK_SECRET");
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!expectedToken || !apiKey) {
    log("error", requestId, "config", { missing: [!expectedToken && "NORA_WEBHOOK_SECRET", !apiKey && "ANTHROPIC_API_KEY"].filter(Boolean) });
    return Response.json({ error: "Server configuration missing", requestId }, { status: 500 });
  }

  if (req.headers.get("Authorization") !== `Bearer ${expectedToken}`) {
    log("warn", requestId, "auth", { result: "unauthorized" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let stage = "parse";
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (_) {
      log("warn", requestId, "parse", { result: "invalid_json" });
      return Response.json({ error: "Invalid JSON body", requestId }, { status: 400 });
    }

    const fileName = body.fileName;
    const fileContent = body.fileContentBase64;
    // Optional extra fields Power Automate MAY send later (ignored if absent):
    const meta = {
      sender: optStr(body.sender ?? body.from, 320),
      subject: optStr(body.subject, 300),
      receivedAt: optStr(body.receivedAt, 64),
    };

    if (
      typeof fileName !== "string" ||
      !/^[a-zA-Z0-9_. -]+\.xlsx$/i.test(fileName) ||
      typeof fileContent !== "string"
    ) {
      log("warn", requestId, "validate", { result: "bad_filename_or_content" });
      return Response.json({ error: "Valid XLSX filename and Base64 content required", requestId }, { status: 400 });
    }

    // Accept either plain Base64 or a Power Automate content wrapper.
    const base64 = fileContent.replace(/\s/g, "");

    if (!base64 || base64.length > 14_000_000) {
      log("warn", requestId, "validate", { result: "empty_or_too_large", base64Length: base64.length });
      return Response.json({ error: "File is empty or too large", requestId }, { status: 413 });
    }

    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      log("warn", requestId, "validate", { result: "invalid_base64" });
      return Response.json({ error: "Invalid Base64 content", requestId }, { status: 400 });
    }

    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

    // XLSX files are ZIP-based and normally begin with PK.
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      log("warn", requestId, "validate", { result: "not_xlsx_container" });
      return Response.json({ error: "File content is not a valid XLSX container", requestId }, { status: 400 });
    }

    const fileSha256 = await sha256Hex(bytes);
    log("info", requestId, "received", { fileName, sizeBytes: bytes.length, fileSha256, hasSender: !!meta.sender });

    // ---- 1) Upload to Anthropic Files API (unchanged request) ----
    stage = "file_upload";
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      fileName,
    );

    const tUp = Date.now();
    const upload = await fetchWithTimeout(stage, "https://api.anthropic.com/v1/files", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "anthropic-version": "2026-10-21",
      },
      body: form,
    }, UPLOAD_TIMEOUT_MS);

    if (!upload.ok) {
      const err = await upstreamError(upload);
      log("error", requestId, stage, { ...err, ms: Date.now() - tUp });
      return Response.json(
        { success: false, stage, requestId, upstreamStatus: err.upstreamStatus, error: "Anthropic file upload failed" },
        { status: 502 },
      );
    }

    const uploaded = await upload.json();
    if (!uploaded?.id) {
      log("error", requestId, stage, { result: "no_file_id" });
      return Response.json({ success: false, stage, requestId, error: "Anthropic returned no file ID" }, { status: 502 });
    }
    log("info", requestId, "file_uploaded", { fileId: uploaded.id, ms: Date.now() - tUp });

    // ---- 2) Create Nora session AND start the analysis in the same call ----
    // POST /v1/sessions with `initial_events` → session is created directly in "running".
    stage = "session_creation";
    const tSes = Date.now();
    const sessionResponse = await fetchWithTimeout(stage, "https://api.anthropic.com/v1/sessions", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "managed-agents-2026-04-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent: AGENT_ID,
        environment_id: ENVIRONMENT_ID,
        title: `Excel analysis – ${fileName}`.slice(0, 500),
        metadata: {
          source: "nora-email-intake",
          request_id: requestId,
          file_name: fileName.slice(0, 512),
          file_id: String(uploaded.id).slice(0, 512),
          file_sha256: fileSha256,
          ...(meta.sender ? { sender: meta.sender.slice(0, 512) } : {}),
        },
        resources: [
          { type: "file", file_id: uploaded.id, mount_path: MOUNT_PATH },
        ],
        budget: { type: "limit", max_list_cost: { amount: "300", currency: "USD" } }, // $3 spend cap per session
        initial_events: [
          {
            type: "user.message",
            content: [{ type: "text", text: analysisPrompt(fileName, meta) }],
          },
        ],
      }),
    }, SESSION_TIMEOUT_MS);

    if (!sessionResponse.ok) {
      const err = await upstreamError(sessionResponse);
      log("error", requestId, stage, { ...err, fileId: uploaded.id, ms: Date.now() - tSes });
      return Response.json(
        {
          success: false,
          stage,
          requestId,
          fileId: uploaded.id,
          upstreamStatus: err.upstreamStatus,
          error: "Could not create and start Nora session",
        },
        { status: 502 },
      );
    }

    const sessionResult = await sessionResponse.json();
    const analysisStarted = sessionResult?.status === "running";
    await registerRun(requestId, {
      status: "analysing",
      file_name: fileName,
      sender: meta.sender ?? null,
      subject: meta.subject ?? null,
      source_file_id: uploaded.id,
      nora_session_id: sessionResult?.id ?? null,
    });

    log(analysisStarted ? "info" : "warn", requestId, "session_started", {
      sessionId: sessionResult?.id,
      sessionStatus: sessionResult?.status,
      fileId: uploaded.id,
      ms: Date.now() - tSes,
      totalMs: Date.now() - t0,
    });

    return Response.json({
      success: true,
      stage: "analysis_started",
      requestId,
      fileId: uploaded.id,
      sessionId: sessionResult?.id,
      sessionStatus: sessionResult?.status,
      analysisStarted,
      fileName,
      message: analysisStarted
        ? "Excel uploaded and Nora has started the analysis."
        : "Excel uploaded and Nora session created; analysis start not confirmed – check the session.",
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      log("error", requestId, error.stage, { result: "timeout", timeoutMs: error.ms, totalMs: Date.now() - t0 });
      return Response.json(
        { success: false, stage: error.stage, requestId, error: `Upstream timeout during ${error.stage}` },
        { status: 504 },
      );
    }
    log("error", requestId, stage, {
      result: "exception",
      errorName: error instanceof Error ? error.name : "Unknown",
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : undefined,
      totalMs: Date.now() - t0,
    });
    return Response.json(
      { success: false, stage, requestId, error: "File processing failed" },
      { status: stage === "parse" ? 400 : 500 },
    );
  }
});
