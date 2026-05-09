    const API_URL = "https://api.freeappstore.online";
    const AGENT_URL = "https://agent.freeappstore.online";
    const PROJECTS_KEY = "fas_projects"; // localStorage key

    const MODEL_OPTIONS = {
      github: [
        { value: "openai/gpt-4.1", label: "GPT-4.1" },
        { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
        { value: "openai/gpt-4o", label: "GPT-4o" },
        { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
        { value: "DeepSeek-V3-0324", label: "DeepSeek V3" },
        { value: "meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout" },
      ],
      anthropic: [
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
      ],
      openai: [
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-4o-mini", label: "GPT-4o Mini" },
        { value: "o3", label: "o3" },
      ],
      google: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      ],
    };

    let currentUser = null;
    let githubToken = null;
    let sessionId = null;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let isStreaming = false;

    // ── Projects (localStorage) ──

    function getProjects() {
      try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]"); } catch { return []; }
    }
    function saveProjects(projects) {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    }
    function getCurrentProjectId() {
      return localStorage.getItem("fas_current_project") || null;
    }
    function setCurrentProjectId(id) {
      localStorage.setItem("fas_current_project", id);
    }

    function renderProjectSelect() {
      const sel = document.getElementById("projectSelect");
      const projects = getProjects();
      sel.innerHTML = projects.map(p =>
        `<option value="${p.id}"${p.id === sessionId ? " selected" : ""}>${p.name}</option>`
      ).join("");
    }

    function createProject(name) {
      const id = crypto.randomUUID();
      const projects = getProjects();
      projects.unshift({ id, name, createdAt: new Date().toISOString() });
      saveProjects(projects);
      return id;
    }

    function switchProject(id) {
      sessionId = id;
      setCurrentProjectId(id);
      renderProjectSelect();
      totalTokensIn = 0;
      totalTokensOut = 0;
      updateTokens(0, 0);
      // Reset provider to default
      document.getElementById("provider").value = "github";
      document.getElementById("apiKey").style.display = "none";
      document.getElementById("apiKey").value = "";
      clearUI();
      loadHistory();
    }

    // ── Auth ──

    async function checkAuth() {
      try {
        const res = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
        const data = await res.json();
        if (data.user) {
          currentUser = data.user;
          if (data.hasGitHubModels) {
            try {
              const tokenRes = await fetch(`${API_URL}/auth/github-token`, { credentials: "include" });
              const tokenData = await tokenRes.json();
              if (tokenData.token) githubToken = tokenData.token;
            } catch {}
          }
          initProjects();
          showApp();
        } else {
          showAuthGate();
        }
      } catch { showAuthGate(); }
    }

    function initProjects() {
      const projects = getProjects();
      if (projects.length === 0) {
        const id = createProject("My App");
        sessionId = id;
        setCurrentProjectId(id);
      } else {
        sessionId = getCurrentProjectId() || projects[0].id;
        setCurrentProjectId(sessionId);
      }
      renderProjectSelect();
      loadHistory();
    }

    async function startSignIn() {
      const res = await fetch(`${API_URL}/auth/github/url?redirect=${encodeURIComponent(window.location.href)}`, { credentials: "include" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    }

    function showAuthGate() {
      document.body.classList.remove("app-mode");
      document.getElementById("authGate").style.display = "flex";
      document.getElementById("appMain").style.display = "none";
    }

    function showApp() {
      document.body.classList.add("app-mode");
      document.getElementById("authGate").style.display = "none";
      document.getElementById("appMain").style.display = "block";
      document.getElementById("userInput").focus();
    }

    document.getElementById("signInBtn").addEventListener("click", (e) => { e.preventDefault(); startSignIn(); });
    checkAuth();

    function toggleSettings() {
      const panel = document.getElementById("settingsPanel");
      panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    }

    // ── Project events ──

    document.getElementById("projectSelect").addEventListener("change", (e) => { switchProject(e.target.value); });
    document.getElementById("newProjectBtn").addEventListener("click", () => {
      const name = prompt("Project name:");
      if (!name) return;
      const id = createProject(name.trim());
      switchProject(id);
    });

    // ── Provider/model selector (persisted in localStorage) ──

    const providerEl = document.getElementById("provider");
    const modelEl = document.getElementById("model");

    function saveModelPrefs() {
      localStorage.setItem("fas_provider", providerEl.value);
      localStorage.setItem("fas_model", modelEl.value);
    }

    function loadModelPrefs() {
      const savedProvider = localStorage.getItem("fas_provider");
      if (savedProvider && MODEL_OPTIONS[savedProvider]) {
        providerEl.value = savedProvider;
        // Rebuild model options for this provider
        const models = MODEL_OPTIONS[savedProvider] || [];
        modelEl.innerHTML = models.map(m => `<option value="${m.value}">${m.label}</option>`).join("");
        const isBYOK = savedProvider !== "github";
        document.getElementById("apiKey").style.display = isBYOK ? "inline" : "none";
      }
      const savedModel = localStorage.getItem("fas_model");
      if (savedModel) {
        modelEl.value = savedModel;
      }
    }

    providerEl.addEventListener("change", () => {
      const models = MODEL_OPTIONS[providerEl.value] || [];
      modelEl.innerHTML = models.map(m => `<option value="${m.value}">${m.label}</option>`).join("");
      const isBYOK = providerEl.value !== "github";
      document.getElementById("apiKey").style.display = isBYOK ? "inline" : "none";
      if (isBYOK) {
        const placeholders = { anthropic: "sk-ant-...", openai: "sk-...", google: "AIza..." };
        document.getElementById("apiKey").placeholder = placeholders[providerEl.value] || "API key";
      }
      saveModelPrefs();
    });

    modelEl.addEventListener("change", saveModelPrefs);

    // Restore on load
    loadModelPrefs();

    // ── Voice input ──

    const micBtn = document.getElementById("micBtn");
    let recognition = null;
    let isListening = false;

    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      let finalTranscript = "";
      let preVoiceText = "";

      recognition.onstart = () => {
        isListening = true;
        micBtn.style.color = "var(--accent)";
        micBtn.style.borderColor = "var(--accent)";
      };
      recognition.onend = () => {
        isListening = false;
        finalTranscript = "";
        micBtn.style.color = "var(--muted)";
        micBtn.style.borderColor = "var(--border)";
      };
      recognition.onerror = () => {
        isListening = false;
        micBtn.style.color = "var(--muted)";
        micBtn.style.borderColor = "var(--border)";
      };
      recognition.onresult = (e) => {
        let interim = "";
        finalTranscript = "";
        for (let i = 0; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        const ui = document.getElementById("userInput");
        ui.value = preVoiceText + finalTranscript + interim;
        ui.style.height = "auto";
        ui.style.height = Math.min(ui.scrollHeight, 100) + "px";
      };

      micBtn.addEventListener("click", () => {
        if (isListening) {
          recognition.stop();
        } else {
          preVoiceText = document.getElementById("userInput").value;
          finalTranscript = "";
          recognition.start();
        }
      });
    } else {
      micBtn.style.display = "none";
    }

    // ── Chat ──

    const userInput = document.getElementById("userInput");
    userInput.addEventListener("input", () => {
      userInput.style.height = "auto";
      userInput.style.height = Math.min(userInput.scrollHeight, 100) + "px";
    });
    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    function addMessage(role, content) {
      const el = document.createElement("div");
      el.className = `msg msg-${role}`;
      el.textContent = content;
      document.getElementById("messages").appendChild(el);
      el.scrollIntoView({ behavior: "smooth", block: "end" });
      return el;
    }

    function clearUI() {
      document.getElementById("messages").innerHTML = '<div class="msg msg-system">Describe the app you want to build.</div>';
      document.getElementById("previewBody").innerHTML = '<div class="preview-placeholder"><p>Your app will appear here once deployed.</p><p style="font-size:0.78rem;color:var(--muted);">Describe your app, the agent builds it, then it deploys automatically.</p></div>';
      document.getElementById("previewUrl").style.display = "none";
      document.getElementById("previewOpen").style.display = "none";
      deployStepsState = {};
    }

    async function loadHistory() {
      if (!sessionId) return;
      try {
        const res = await fetch(`${AGENT_URL}/session/${sessionId}/history`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.messages || data.messages.length === 0) return;

        // Clear default message and render history
        document.getElementById("messages").innerHTML = "";
        for (const m of data.messages) {
          if (m.role === "assistant" && m.toolCalls) {
            if (m.content) addMessage("assistant", m.content);
            for (const tc of m.toolCalls) {
              const label = tc.name === "deploy" ? "Deployed" :
                            tc.name === "write_file" ? `Wrote ${tc.input.path || "file"}` :
                            tc.name === "read_file" ? `Read ${tc.input.path || "file"}` : tc.name;
              addMessage("tool", label);
            }
          } else {
            addMessage(m.role, m.content);
          }
        }

        // Restore deploy status / preview
        if (data.deployStatus) {
          if (data.deployStatus.phase === "live") {
            showPreview(data.deployStatus.appUrl);
          } else if (data.deployStatus.phase === "provisioning" || data.deployStatus.phase === "pushing" || data.deployStatus.phase === "building") {
            initDeployLog();
            setDeployStatus(data.deployStatus.phase, null, data.deployStatus.steps);
          }
        }
        if (data.tokenUsage) {
          totalTokensIn = data.tokenUsage.input || 0;
          totalTokensOut = data.tokenUsage.output || 0;
          updateTokens(0, 0);
        }
        // Update project name if app was deployed
        if (data.appName) {
          const projects = getProjects();
          const p = projects.find(x => x.id === sessionId);
          if (p && p.name === "My App") {
            p.name = data.appName;
            saveProjects(projects);
            renderProjectSelect();
          }
        }
      } catch {}
    }

    function updateTokens(input, output) {
      if (input) totalTokensIn += input;
      if (output) totalTokensOut += output;
      document.getElementById("tokensIn").textContent = totalTokensIn.toLocaleString();
      document.getElementById("tokensOut").textContent = totalTokensOut.toLocaleString();
    }

    // Deploy pipeline steps shown in the preview body
    const DEPLOY_STEPS = ["GitHub repo", "CF Pages", "Custom domain", "DNS", "Store listing", "Pushing code", "Building", "Live"];
    let deployStepsState = {}; // { stepName: "done"|"active"|"skip"|"fail"|"pending" }

    function initDeployLog() {
      deployStepsState = {};
      DEPLOY_STEPS.forEach(s => deployStepsState[s] = "pending");
      renderDeployLog();
    }

    function renderDeployLog() {
      const body = document.getElementById("previewBody");
      let html = '<div class="deploy-log"><h3>Deploying your app</h3>';
      for (const name of DEPLOY_STEPS) {
        const state = deployStepsState[name] || "pending";
        const icon = state === "done" ? "done" : state === "skip" ? "skip" : state === "fail" ? "fail" : state === "active" ? "active" : "pending";
        html += `<div class="deploy-step ${icon}"><span class="dot"></span> ${name}</div>`;
      }
      // Show live banner if we're done
      if (deployStepsState["Live"] === "done") {
        const url = deployStepsState._appUrl || "";
        html += `<div class="deploy-live-banner">Your app is live! <a href="${url}" target="_blank">${url.replace("https://","")}</a></div>`;
      }
      html += '</div>';
      body.innerHTML = html;
    }

    function setDeployStatus(phase, detail, steps) {
      if (phase === "provisioning") {
        if (Object.keys(deployStepsState).length === 0) initDeployLog();
        // Update steps from the provisioning data
        if (steps && steps.length) {
          for (const s of steps) {
            if (deployStepsState[s.name] !== undefined) {
              deployStepsState[s.name] = s.status === "ok" ? "done" : s.status === "skip" ? "skip" : "fail";
            }
          }
          // Mark next pending step as active
          for (const name of DEPLOY_STEPS) {
            if (deployStepsState[name] === "pending") { deployStepsState[name] = "active"; break; }
          }
        }
        renderDeployLog();
      } else if (phase === "pushing") {
        ["GitHub repo", "CF Pages", "Custom domain", "DNS", "Store listing"].forEach(s => {
          if (deployStepsState[s] === "pending" || deployStepsState[s] === "active") deployStepsState[s] = "done";
        });
        deployStepsState["Pushing code"] = "active";
        renderDeployLog();
      } else if (phase === "building") {
        deployStepsState["Pushing code"] = "done";
        deployStepsState["Building"] = "active";
        renderDeployLog();
      } else if (phase === "live") {
        DEPLOY_STEPS.forEach(s => { if (deployStepsState[s] !== "fail" && deployStepsState[s] !== "skip") deployStepsState[s] = "done"; });
        deployStepsState._appUrl = detail?.replace("Live at ", "") || "";
        renderDeployLog();
      } else if (phase === "error") {
        // Mark current active as fail
        for (const name of DEPLOY_STEPS) {
          if (deployStepsState[name] === "active") { deployStepsState[name] = "fail"; break; }
        }
        renderDeployLog();
      }
    }

    function showPreview(url) {
      if (!url || !url.startsWith("https://")) return;
      const body = document.getElementById("previewBody");
      const urlEl = document.getElementById("previewUrl");
      const openEl = document.getElementById("previewOpen");
      body.innerHTML = `<iframe src="${url}" title="App preview"></iframe>`;
      urlEl.textContent = url.replace("https://", "");
      urlEl.href = url;
      urlEl.style.display = "inline";
      openEl.href = url;
      openEl.style.display = "inline";
    }

    async function sendMessage() {
      const message = userInput.value.trim();
      if (!message || isStreaming) return;
      if (isListening && recognition) recognition.stop();

      const provider = providerEl.value;
      let apiKey;
      if (provider === "github") {
        if (!githubToken) { addMessage("system", "GitHub Models not available. Sign out and back in, or use a BYOK provider."); return; }
        apiKey = githubToken;
      } else {
        apiKey = document.getElementById("apiKey").value.trim();
        if (!apiKey) { addMessage("system", "Enter your API key to use this provider."); return; }
      }

      isStreaming = true;
      document.getElementById("sendBtn").disabled = true;
      userInput.value = "";
      userInput.style.height = "auto";

      addMessage("user", message);
      const assistantEl = addMessage("assistant", "");
      assistantEl.innerHTML = '<span class="streaming-dot"></span>';

      try {
        const res = await fetch(`${AGENT_URL}/session/${sessionId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, aiConfig: {
            provider,
            model: modelEl.value,
            apiKey,
            temperature: parseFloat(document.getElementById("temperature").value),
            maxTokens: parseInt(document.getElementById("maxTokens").value),
          } }),
        });

        if (!res.ok) { assistantEl.textContent = `Error: ${await res.text()}`; return; }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let assistantText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            let evt;
            try { evt = JSON.parse(raw); } catch { continue; }

            if (evt.type === "text") {
              assistantText += evt.data;
              assistantEl.textContent = assistantText;
            } else if (evt.type === "tool_call") {
              const tc = JSON.parse(evt.data);
              const label = tc.name === "deploy" ? `Deploying: ${tc.input.name}...` :
                            tc.name === "push_update" ? `Pushing update to ${tc.input.id}...` :
                            tc.name === "write_file" ? `Writing ${tc.input.path}` :
                            tc.name === "read_file" ? `Reading ${tc.input.path}` :
                            tc.name === "delete_file" ? `Deleting ${tc.input.path}` :
                            tc.name === "search_files" ? `Searching for "${tc.input.pattern}"` :
                            tc.name === "run_compliance_check" ? "Running compliance checks..." :
                            tc.name === "get_build_logs" ? `Fetching build logs for ${tc.input.id}` :
                            tc.name === "get_ci_results" ? `Checking CI for ${tc.input.id}` :
                            tc.name === "get_audit_results" ? `Fetching audit for ${tc.input.id}` :
                            tc.name === "check_deploy_status" ? `Checking deploy: ${tc.input.id}` :
                            tc.name === "list_deployed_apps" ? "Listing deployed apps..." :
                            tc.name;
              addMessage("tool", label);
            } else if (evt.type === "tool_result") {
              const tr = JSON.parse(evt.data);
              if (tr.tool === "deploy") {
                initDeployLog();
              } else if (tr.result && tr.result !== "executing...") {
                // Show meaningful tool results (compliance check results, search results, infra results)
                const result = tr.result.slice(0, 400);
                // Skip write_file/read_file/list_files/delete_file results (already shown as tool_call labels)
                if (!["write_file","read_file","list_files","delete_file"].includes(tr.tool)) {
                  addMessage("tool", `${tr.tool}:\n${result}`);
                }
              }
            } else if (evt.type === "usage") {
              const u = JSON.parse(evt.data);
              updateTokens(u.input, u.output);
            } else if (evt.type === "deploy_status") {
              const ds = JSON.parse(evt.data);
              if (ds.phase === "live") { setDeployStatus("live", `Live at ${ds.appUrl}`); setTimeout(() => showPreview(ds.appUrl), 1500); }
              else if (ds.phase === "error") setDeployStatus("error", ds.error);
              else if (ds.phase === "building") setDeployStatus("building");
              else if (ds.phase === "pushing") setDeployStatus("pushing");
              else if (ds.phase === "provisioning") setDeployStatus("provisioning", null, ds.steps);
            } else if (evt.type === "error") {
              assistantText += `\nError: ${evt.data}`;
              assistantEl.textContent = assistantText;
            }
          }
        }
        if (!assistantText) assistantEl.textContent = "(No response)";
      } catch (err) {
        assistantEl.textContent = `Connection error: ${err.message}`;
      } finally {
        isStreaming = false;
        document.getElementById("sendBtn").disabled = false;
        userInput.focus();
      }
    }

    // ── Copy chat as JSON ──
    async function copyChatJSON() {
      const msgs = document.getElementById("messages").children;
      const chat = [];
      for (const el of msgs) {
        const role = el.classList.contains("msg-user") ? "user" :
                     el.classList.contains("msg-assistant") ? "assistant" :
                     el.classList.contains("msg-tool") ? "tool" : "system";
        chat.push({ role, content: el.textContent });
      }
      // Fetch server-side errors + session status for debugging
      let serverErrors = [];
      let serverStatus = {};
      try {
        const [errRes, statusRes] = await Promise.all([
          fetch(`${AGENT_URL}/session/${sessionId}/errors`).then(r => r.json()).catch(() => ({})),
          fetch(`${AGENT_URL}/session/${sessionId}/status`).then(r => r.json()).catch(() => ({})),
        ]);
        serverErrors = errRes.errors || [];
        serverStatus = statusRes;
      } catch {}
      const json = JSON.stringify({
        project: document.getElementById("projectSelect").selectedOptions[0]?.text || "unknown",
        sessionId,
        provider: providerEl.value,
        model: modelEl.value,
        tokens: { input: totalTokensIn, output: totalTokensOut },
        messages: chat,
        server: { errors: serverErrors, status: serverStatus },
        exportedAt: new Date().toISOString(),
      }, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        const btn = document.getElementById("copyJsonBtn");
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "JSON"; }, 1500);
      });
    }

