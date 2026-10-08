(() => {
  // src/renderer.js
  var ANIMATIONS = Object.freeze({
    idle: { row: 0, frames: 6, frameInterval: 160 },
    runningRight: { row: 1, frames: 8, frameInterval: 120 },
    runningLeft: { row: 2, frames: 8, frameInterval: 120 },
    waving: { row: 3, frames: 4, frameInterval: 140 },
    jumping: { row: 4, frames: 5, frameInterval: 140 },
    failed: { row: 5, frames: 8, frameInterval: 140 },
    waiting: { row: 6, frames: 6, frameInterval: 150 },
    running: { row: 7, frames: 6, frameInterval: 120 },
    review: { row: 8, frames: 6, frameInterval: 150 }
  });
  var ALIASES = { "running-right": "runningRight", "running-left": "runningLeft", thinking: "review", working: "running", done: "jumping" };
  function resolveLook(direction, deadzone = 0) {
    if (direction == null) return void 0;
    let degrees;
    if (typeof direction === "number") degrees = direction;
    else {
      if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return void 0;
      const magnitude = Math.hypot(direction.x, direction.y);
      if (magnitude === 0 || magnitude <= Math.max(0, deadzone)) return void 0;
      degrees = Math.atan2(direction.x, -direction.y) * 180 / Math.PI;
    }
    if (!Number.isFinite(degrees)) return void 0;
    const normalized = (degrees % 360 + 360) % 360;
    return Math.round(normalized / 22.5) % 16;
  }
  function pinPlacement(pin, pw, ph, w, h, margin = 16) {
    let x, y;
    switch (pin) {
      case "top-left":
        x = margin;
        y = margin;
        break;
      case "top":
        x = (pw - w) / 2;
        y = margin;
        break;
      case "top-right":
        x = pw - w - margin;
        y = margin;
        break;
      case "left":
        x = margin;
        y = (ph - h) / 2;
        break;
      case "center":
        x = (pw - w) / 2;
        y = (ph - h) / 2;
        break;
      case "right":
        x = pw - w - margin;
        y = (ph - h) / 2;
        break;
      case "bottom-left":
        x = margin;
        y = ph - h - margin;
        break;
      case "bottom":
        x = (pw - w) / 2;
        y = ph - h - margin;
        break;
      default:
        x = pw - w - margin;
        y = ph - h - margin;
    }
    return clampPosition({ x, y }, pw, ph, w, h);
  }
  function clampPosition(position, pw, ph, width, height) {
    return { x: Math.max(0, Math.min(position.x, Math.max(0, pw - width))), y: Math.max(0, Math.min(position.y, Math.max(0, ph - height))) };
  }
  function createPet(container, options) {
    const isAtlas = options.kind === "atlas", columns = isAtlas ? 8 : 1, rows = isAtlas ? options.spriteVersionNumber === 2 ? 11 : 9 : 1;
    const frameWidth = isAtlas ? 192 : options.width, frameHeight = isAtlas ? 208 : options.height;
    let scale = options.size / frameWidth;
    const sprite = document.createElement("div");
    sprite.className = `ark-pet-sprite${isAtlas ? "" : " ark-pet-image"}`;
    sprite.setAttribute("role", "img");
    sprite.setAttribute("aria-label", options.displayName);
    sprite.style.backgroundImage = `url("${options.src}")`;
    sprite.style.position = "absolute";
    sprite.style.backgroundRepeat = "no-repeat";
    sprite.style.touchAction = "none";
    sprite.style.pointerEvents = "auto";
    sprite.style.cursor = "grab";
    sprite.style.userSelect = "none";
    container.appendChild(sprite);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let animationName = "idle", current = ANIMATIONS.idle, frame = 0, elapsed = 0, lookIndex, once = false, then = "idle";
    let raf = 0, previous = 0, disposed = false, dragging = false, restore = "idle", lastX = 0, offset = { x: 0, y: 0 }, position;
    function paint() {
      const row = !isAtlas ? 0 : lookIndex !== void 0 ? 9 + Math.floor(lookIndex / 8) : current.row;
      const col = !isAtlas ? 0 : lookIndex !== void 0 ? lookIndex % 8 : frame % current.frames;
      sprite.style.width = `${frameWidth * scale}px`;
      sprite.style.height = `${frameHeight * scale}px`;
      sprite.style.backgroundSize = `${frameWidth * columns * scale}px ${frameHeight * rows * scale}px`;
      sprite.style.backgroundPosition = `${-col * frameWidth * scale}px ${-row * frameHeight * scale}px`;
      sprite.dataset.animation = animationName;
    }
    function place() {
      const w = frameWidth * scale, h = frameHeight * scale;
      const pw = container.clientWidth || window.innerWidth, ph = container.clientHeight || window.innerHeight;
      position = options.position ? clampPosition(options.position, pw, ph, w, h) : pinPlacement(options.pin, pw, ph, w, h);
      sprite.style.left = `${position.x}px`;
      sprite.style.top = `${position.y}px`;
      options.onPosition?.({ ...position, width: w, height: h });
    }
    function animate(name, settings = {}) {
      animationName = ALIASES[name] ?? name;
      current = ANIMATIONS[animationName] ?? ANIMATIONS.idle;
      frame = 0;
      elapsed = 0;
      once = settings.once === true;
      then = settings.then ?? "idle";
      lookIndex = void 0;
      paint();
    }
    function tick(time) {
      if (disposed) return;
      const dt = previous ? Math.min(250, Math.max(0, time - previous)) : 0;
      previous = time;
      if (isAtlas && !motion?.matches && (lookIndex === void 0 || once)) {
        elapsed += dt;
        while (elapsed >= current.frameInterval) {
          elapsed -= current.frameInterval;
          frame++;
          if (frame >= current.frames) {
            if (once) animate(then);
            else frame = 0;
          }
        }
        paint();
      }
      raf = requestAnimationFrame(tick);
    }
    sprite.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const box = sprite.getBoundingClientRect();
      offset = { x: event.clientX - box.left, y: event.clientY - box.top };
      dragging = true;
      restore = animationName;
      lastX = event.clientX;
      lookIndex = void 0;
      sprite.setPointerCapture?.(event.pointerId);
      sprite.style.cursor = "grabbing";
      event.preventDefault();
    });
    sprite.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const delta = event.clientX - lastX;
      lastX = event.clientX;
      if (isAtlas && Math.abs(delta) > 4) {
        const next = delta > 0 ? "runningRight" : "runningLeft";
        if (next !== animationName) animate(next);
      }
      const box = container.getBoundingClientRect();
      position = clampPosition({ x: event.clientX - box.left - offset.x, y: event.clientY - box.top - offset.y }, box.width, box.height, frameWidth * scale, frameHeight * scale);
      sprite.style.left = `${position.x}px`;
      sprite.style.top = `${position.y}px`;
      options.onPosition?.({ ...position, width: frameWidth * scale, height: frameHeight * scale });
    });
    const release = (event) => {
      if (!dragging) return;
      dragging = false;
      sprite.style.cursor = "grab";
      if (sprite.hasPointerCapture?.(event.pointerId)) sprite.releasePointerCapture(event.pointerId);
      if (isAtlas) animate(restore);
      options.position = position;
      options.onDragEnd?.({ ...position });
    };
    sprite.addEventListener("pointerup", release);
    sprite.addEventListener("pointercancel", release);
    sprite.addEventListener("pointerenter", () => {
      if (isAtlas && !dragging && animationName === "idle") animate("waving", { once: true, then: "idle" });
    });
    sprite.addEventListener("dblclick", () => {
      if (dragging) return;
      if (isAtlas) animate("jumping", { once: true, then: animationName === "waving" ? "idle" : animationName });
      else if (!motion?.matches) sprite.animate?.([{ transform: "translateY(0)" }, { transform: "translateY(-16px)" }, { transform: "translateY(0)" }], { duration: 420 });
    });
    const onResize = () => {
      if (!dragging) place();
    };
    const onMotion = () => {
      frame = 0;
      paint();
    };
    window.addEventListener("resize", onResize);
    motion?.addEventListener?.("change", onMotion);
    place();
    paint();
    if (isAtlas) raf = requestAnimationFrame(tick);
    return {
      element: sprite,
      get dragging() {
        return dragging;
      },
      get animation() {
        return animationName;
      },
      setAnimation(name) {
        if (!dragging) animate(name);
      },
      setLook(direction, deadzone = 28) {
        if (options.spriteVersionNumber !== 2 || !isAtlas || dragging || once || motion?.matches) return;
        lookIndex = resolveLook(direction, deadzone);
        paint();
      },
      clearLook() {
        if (lookIndex !== void 0) {
          lookIndex = void 0;
          paint();
        }
      },
      updatePlacement(settings) {
        Object.assign(options, settings);
        scale = options.size / frameWidth;
        if (!dragging) {
          paint();
          place();
        }
      },
      dispose() {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        motion?.removeEventListener?.("change", onMotion);
        sprite.remove();
      }
    };
  }

  // src/client.js
  var POLL_MS = 2e3;
  var PINS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
  var MARGIN = 16;
  function read(response) {
    return response.text().then((text) => {
      let value = null;
      try {
        value = text ? JSON.parse(text) : null;
      } catch {
        value = null;
      }
      if (!response.ok) throw new Error(value?.error || `HTTP ${response.status}`);
      return value;
    });
  }
  function get(path) {
    return fetch(path, { credentials: "same-origin" }).then(read);
  }
  function post(path, body, contentType) {
    return fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-dsh-ark-pet": "1", ...contentType ? { "content-type": contentType } : {} },
      body
    }).then(read);
  }
  function bubbleText(activity) {
    if (!activity || !activity.phase) return "";
    let text = "";
    if (activity.phase === "thinking") text = "\u601D\u8003\u4E2D\u2026";
    else if (activity.phase === "working") text = activity.tool ? `\u8FD0\u884C\u4E2D\uFF1A${activity.tool}\u2026` : "\u5DE5\u4F5C\u4E2D\u2026";
    else if (activity.phase === "waiting") text = "\u7B49\u5F85\u4F60\u7684\u786E\u8BA4\u2026";
    else if (activity.phase === "done") text = "\u5B8C\u6210";
    else if (activity.phase === "failed") text = "\u51FA\u9519\u4E86";
    if (!text) return "";
    return activity.activeSessions > 1 ? `${text} (+${activity.activeSessions - 1})` : text;
  }
  window.__ModuleLoader__.load({
    id: "dsh-ark-pet",
    factory: (require2) => {
      const react = require2("react");
      let createPortal = null;
      try {
        createPortal = require2("react-dom").createPortal;
      } catch {
        createPortal = null;
      }
      const section = { display: "grid", gap: "10px", maxWidth: "520px", fontSize: "13px" };
      const row = { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" };
      const rowLabel = { minWidth: "130px", color: "var(--dsw-alias-label-secondary)" };
      const hint = { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", margin: 0 };
      const control = { padding: "5px 8px", borderRadius: "6px", border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)" };
      const button = { padding: "7px 12px", borderRadius: "7px", border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", cursor: "pointer" };
      const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: "6px", maxHeight: "260px", overflowY: "auto" };
      const error = { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px", margin: 0 };
      function Field({ label, children }) {
        return react.createElement(
          "label",
          { style: row },
          react.createElement("span", { style: rowLabel }, label),
          children
        );
      }
      function Toggle({ label, checked, onChange }) {
        return react.createElement(
          "label",
          { style: { ...row, cursor: "pointer" } },
          react.createElement("input", { type: "checkbox", checked, onChange: (event) => onChange(event.target.checked) }),
          react.createElement("span", null, label)
        );
      }
      function PetOverlay() {
        const hostRef = react.useRef(null);
        const petRef = react.useRef(null);
        const boxRef = react.useRef(null);
        const [state, setState] = react.useState(null);
        const [box, setBox] = react.useState(null);
        const [problem, setProblem] = react.useState("");
        react.useEffect(() => {
          let stopped = false;
          const load = async () => {
            try {
              const next = await get("/ark-pet/api/state");
              if (!stopped) {
                setState(next);
                setProblem("");
              }
            } catch (failure) {
              if (!stopped) setProblem(String(failure.message || failure));
            }
          };
          load();
          const timer = window.setInterval(() => {
            if (!document.hidden) load();
          }, POLL_MS);
          return () => {
            stopped = true;
            window.clearInterval(timer);
          };
        }, []);
        const selected = state?.selected;
        const config = state?.config;
        const phase = state?.activity?.phase || "idle";
        react.useEffect(() => {
          if (!selected || !config || config.visible === false || !hostRef.current) return void 0;
          const pet = createPet(hostRef.current, {
            kind: selected.kind,
            width: selected.width,
            height: selected.height,
            spriteVersionNumber: selected.spriteVersionNumber,
            src: selected.atlasUrl,
            size: config.size,
            pin: config.pin,
            position: config.position,
            displayName: selected.displayName,
            onPosition: (value) => {
              boxRef.current = value;
              setBox(value);
            },
            onDragEnd: (value) => {
              post("/ark-pet/api/config", JSON.stringify({ position: value })).catch(() => {
              });
            }
          });
          petRef.current = pet;
          return () => {
            petRef.current = null;
            pet.dispose();
          };
        }, [selected?.id, selected?.atlasUrl, config?.visible]);
        react.useEffect(() => {
          if (!petRef.current || !config) return;
          petRef.current.updatePlacement({ size: config.size, pin: config.pin, position: config.position });
        }, [config?.size, config?.pin]);
        react.useEffect(() => {
          if (!petRef.current) return;
          petRef.current.setAnimation(phase);
        }, [phase, selected?.id]);
        react.useEffect(() => {
          if (!config?.mouseTracking || selected?.spriteVersionNumber !== 2) return void 0;
          const onMove = (event) => {
            const pet = petRef.current;
            if (!pet || pet.dragging) return;
            const rect = pet.element.getBoundingClientRect();
            pet.setLook({ x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) });
          };
          window.addEventListener("pointermove", onMove, { passive: true });
          return () => window.removeEventListener("pointermove", onMove);
        }, [config?.mouseTracking, selected?.spriteVersionNumber, selected?.atlasUrl]);
        if (!config || !selected) return null;
        const text = config.bubble === false ? "" : bubbleText(state.activity);
        const children = [];
        if (text && box) {
          children.push(react.createElement("div", {
            key: "bubble",
            className: "ark-pet-bubble",
            style: {
              position: "absolute",
              left: `${Math.min(Math.max(box.x + box.width / 2, MARGIN + 80), (hostRef.current?.clientWidth || window.innerWidth) - MARGIN - 80)}px`,
              top: `${Math.max(MARGIN, box.y - 34)}px`,
              transform: "translateX(-50%)",
              maxWidth: "260px",
              padding: "6px 10px",
              borderRadius: "10px",
              border: "1px solid var(--dsw-alias-border-l1)",
              background: "var(--dsw-alias-bg-overlay)",
              color: "var(--dsw-alias-label-primary)",
              fontSize: "12px",
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              pointerEvents: "none"
            }
          }, text));
        }
        if (problem) children.push(react.createElement("div", { key: "error", className: "ark-pet-error", style: { ...error, position: "absolute", right: "12px", bottom: "12px" } }, problem));
        const host = react.createElement("div", {
          ref: hostRef,
          className: "ark-pet-host",
          "data-dsh-ark-pet": "overlay",
          style: { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 2147483e3 }
        }, children);
        return createPortal ? createPortal(host, document.body) : host;
      }
      function PetSettings() {
        const [state, setState] = react.useState(null);
        const [catalog, setCatalog] = react.useState(null);
        const [query, setQuery] = react.useState("");
        const [accepted, setAccepted] = react.useState(false);
        const [name, setName] = react.useState("");
        const [mode, setMode] = react.useState("auto");
        const [busy, setBusy] = react.useState("");
        const [message, setMessage] = react.useState("");
        const fileRef = react.useRef(null);
        react.useEffect(() => {
          get("/ark-pet/api/state").then(setState).catch((failure) => setMessage(String(failure.message || failure)));
          get("/ark-pet/api/catalog").then(setCatalog).catch((failure) => setMessage(String(failure.message || failure)));
        }, []);
        const configure = (patch) => {
          post("/ark-pet/api/config", JSON.stringify(patch)).then((next) => {
            setState(next);
            setMessage("");
          }).catch((failure) => setMessage(String(failure.message || failure)));
        };
        const run = (key, operation) => {
          setBusy(key);
          operation().then((next) => {
            setState(next);
            setMessage("");
          }).catch((failure) => setMessage(String(failure.message || failure))).finally(() => setBusy(""));
        };
        if (!state) return react.createElement("div", { className: "ark-pet-section", style: section }, message || "\u6B63\u5728\u8F7D\u5165\u2026 / Loading\u2026");
        const needle = query.trim().toLowerCase();
        const filtered = (catalog?.entries ?? []).filter((entry) => !needle || entry.displayName.toLowerCase().includes(needle) || entry.id.includes(needle)).slice(0, 120);
        return react.createElement(
          "div",
          { className: "ark-pet-section", style: section },
          react.createElement(
            "p",
            { style: hint },
            `\u7D20\u6750\u5E93\u56FA\u5B9A\u7248\u672C ${catalog?.revision?.slice(0, 12) ?? "\u2026"}\uFF0C\u5171 ${catalog?.entries?.length ?? 0} \u4F4D\u5E72\u5458\u3002\u4E0B\u8F7D\u65F6\u76F4\u63A5\u8BFB\u53D6\u4E0A\u6E38\u6587\u4EF6\u5E76\u9010\u4E2A\u6821\u9A8C Git \u54C8\u5E0C\u3002`
          ),
          react.createElement(
            Field,
            { label: "\u5F53\u524D\u5BA0\u7269 / Current" },
            react.createElement("select", {
              style: control,
              value: state.config.selectedId,
              onChange: (event) => run("select", () => post("/ark-pet/api/select", JSON.stringify({ id: event.target.value })))
            }, state.entries.map((entry) => react.createElement("option", { key: entry.id, value: entry.id }, `${entry.displayName}\uFF08${entry.origin}\uFF09`)))
          ),
          react.createElement(
            Field,
            { label: "\u5C3A\u5BF8 / Size" },
            react.createElement("input", {
              type: "range",
              min: 48,
              max: 384,
              step: 8,
              value: state.config.size,
              onChange: (event) => configure({ size: Number(event.target.value) })
            })
          ),
          react.createElement(
            Field,
            { label: "\u505C\u9760 / Dock" },
            react.createElement("select", {
              style: control,
              value: state.config.pin,
              onChange: (event) => configure({ pin: event.target.value })
            }, PINS.map((pin) => react.createElement("option", { key: pin, value: pin }, pin)))
          ),
          react.createElement(Toggle, { label: "\u663E\u793A\u684C\u5BA0 / Show pet", checked: state.config.visible, onChange: (value) => configure({ visible: value }) }),
          react.createElement(Toggle, { label: "\u9F20\u6807\u89C6\u7EBF\u8DDF\u968F / Eye tracking\uFF08\u4EC5 v2 \u56FE\u96C6\uFF09", checked: state.config.mouseTracking, onChange: (value) => configure({ mouseTracking: value }) }),
          react.createElement(Toggle, { label: "\u72B6\u6001\u6C14\u6CE1 / Status bubble", checked: state.config.bubble, onChange: (value) => configure({ bubble: value }) }),
          react.createElement("button", { type: "button", style: { ...button, justifySelf: "start" }, onClick: () => run("reset", () => post("/ark-pet/api/reset-position", "{}")) }, "\u6062\u590D\u9ED8\u8BA4\u4F4D\u7F6E / Reset position"),
          react.createElement("h4", { style: { margin: "6px 0 0" } }, "\u5BFC\u5165\u81EA\u5DF1\u7684\u56FE\u7247 / Import your own image"),
          react.createElement("p", { style: hint }, "Codex \u56FE\u96C6\u5FC5\u987B\u6B63\u597D 1536\xD71872\uFF08v1\uFF09\u6216 1536\xD72288\uFF08v2\uFF09\u3002\u666E\u901A PNG / WebP / GIF \u6309\u539F\u56FE\u663E\u793A\uFF0C\u5355\u5F20\u4E0D\u8D85\u8FC7 8 MiB\uFF0CPNG \u4E0E GIF \u4E0D\u80FD\u662F\u52A8\u753B\u3002"),
          react.createElement(
            Field,
            { label: "\u540D\u79F0 / Name" },
            react.createElement("input", { style: control, type: "text", value: name, maxLength: 80, placeholder: "\u6211\u7684\u684C\u5BA0", onChange: (event) => setName(event.target.value) })
          ),
          react.createElement(
            Field,
            { label: "\u7C7B\u578B / Mode" },
            react.createElement(
              "select",
              { style: control, value: mode, onChange: (event) => setMode(event.target.value) },
              react.createElement("option", { value: "auto" }, "\u81EA\u52A8\u5224\u65AD / Auto"),
              react.createElement("option", { value: "atlas" }, "Codex \u56FE\u96C6 / Atlas"),
              react.createElement("option", { value: "image" }, "\u666E\u901A\u56FE\u7247 / Plain image")
            )
          ),
          react.createElement(
            Field,
            { label: "\u6587\u4EF6 / File" },
            react.createElement("input", { type: "file", accept: "image/png,image/webp,image/gif", ref: fileRef })
          ),
          react.createElement("button", {
            type: "button",
            style: { ...button, justifySelf: "start" },
            disabled: busy === "import",
            onClick: () => {
              const file = fileRef.current?.files?.[0];
              if (!file) {
                setMessage("\u5148\u9009\u62E9\u4E00\u4E2A\u56FE\u7247\u6587\u4EF6 / Choose an image file first");
                return;
              }
              run("import", () => post(`/ark-pet/api/import?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(name)}`, file, file.type || "application/octet-stream"));
            }
          }, busy === "import" ? "\u5BFC\u5165\u4E2D\u2026 / Importing\u2026" : "\u5BFC\u5165 / Import"),
          react.createElement("h4", { style: { margin: "6px 0 0" } }, "\u5E72\u5458\u7D20\u6750\u5E93 / Operator library"),
          react.createElement("p", { style: hint }, "\u7D20\u6750\u4E0D\u968F\u63D2\u4EF6\u5206\u53D1\u3002\u9009\u4E2D\u5E72\u5458\u540E\u4ECE\u4E0A\u6E38\u4ED3\u5E93\u6309\u56FA\u5B9A\u7248\u672C\u4E0B\u8F7D\uFF0C\u4FDD\u7559\u6765\u6E90\u6587\u4EF6\uFF0C\u5E76\u6821\u9A8C\u54C8\u5E0C\u3002"),
          react.createElement(
            "label",
            { style: { ...row, cursor: "pointer" } },
            react.createElement("input", { type: "checkbox", checked: accepted, onChange: (event) => setAccepted(event.target.checked) }),
            react.createElement("span", null, "\u6211\u4E86\u89E3\uFF1A\u660E\u65E5\u65B9\u821F\u7F8E\u672F\u6743\u5229\u5C5E\u4E8E\u9E70\u89D2\u7F51\u7EDC\u53CA\u76F8\u5173\u6743\u5229\u4EBA\uFF0C\u4E0A\u6E38\u4E0D\u6388\u4E88\u518D\u5206\u53D1\u6216\u5546\u4E1A\u4F7F\u7528\u6743\uFF0C\u516C\u5F00\u94FE\u63A5\u4E0E\u4E0B\u8F7D\u786E\u8BA4\u90FD\u4E0D\u4EA7\u751F\u6388\u6743\u3002")
          ),
          react.createElement(
            Field,
            { label: "\u641C\u7D22 / Search" },
            react.createElement("input", { style: control, type: "search", value: query, placeholder: "\u963F\u7C73\u5A05 / Amiya", onChange: (event) => setQuery(event.target.value) })
          ),
          react.createElement("div", { style: grid }, filtered.map((entry) => react.createElement("button", {
            key: entry.id,
            type: "button",
            style: { ...button, opacity: accepted ? 1 : 0.5, cursor: accepted && !entry.installed ? "pointer" : "default" },
            disabled: !accepted || entry.installed || busy === entry.id,
            title: entry.installed ? "\u5DF2\u5B89\u88C5 / Installed" : `${Math.round(entry.bytes / 1024)} KiB \xB7 ${entry.sourceUrl}`,
            onClick: () => run(entry.id, () => post("/ark-pet/api/download", JSON.stringify({ id: entry.id, acceptRights: true })))
          }, `${entry.displayName}${entry.installed ? " \u2713" : ""}`))),
          message ? react.createElement("p", { style: error }, message) : null
        );
      }
      const inject = ["slots"];
      function apply(ctx) {
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "dsh-ark-pet",
          order: 100,
          label: "Ark Pet"
        }, () => react.createElement(PetOverlay)));
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "ark-pet",
          order: 130,
          label: "\u65B9\u821F\u684C\u5BA0"
        }, () => react.createElement(PetSettings)));
      }
      const module = { exports: {} };
      module.exports.apply = apply;
      module.exports.inject = inject;
      module.exports.__internals = { bubbleText, PetOverlay, PetSettings };
      return module.exports;
    }
  });
})();
