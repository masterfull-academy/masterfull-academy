const DRAFT_KEY = "aulaquiz_local_drafts_v1";
const ACTIVE_ATTEMPT_KEY = "aulaquiz_active_attempt_v2";
const PENDING_RESULTS_KEY = "aulaquiz_pending_results_v1";
const SOUND_KEY = "aulaquiz_sound_enabled_v1";
const CATALOG_URL = "./data/catalog.json";

const emptyDrafts = { courses: [], exams: [] };
let drafts = load(DRAFT_KEY, emptyDrafts);
let pendingResults = load(PENDING_RESULTS_KEY, []);
let sb = null;
let currentUser = null;
let catalog = null;
let catalogCourses = [];
let catalogExams = [];
let courseChanges = [];
let publishedCourses = [];
let publishedExams = [];
let results = [];
let activeExam = null;
let activeCourse = null;
let activeQuestions = [];
let timerInterval = null;
let secondsLeft = 0;
let examStartedAt = null;
let activeSubmissionId = null;
let finishingExam = false;
let builderQuestions = [];
let builderOptionCount = 5;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== "false";
let audioContext = null;
let minuteWarningPlayed = false;
let appReady = false;

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? structuredClone(fallback); }
  catch { return structuredClone(fallback); }
}
function saveDrafts() { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); }
function savePending() { localStorage.setItem(PENDING_RESULTS_KEY, JSON.stringify(pendingResults)); }
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[char]));
}
function empty(message, colspan = 1) { return `<tr><td colspan="${colspan}" class="empty">${esc(message)}</td></tr>`; }
function emptyCard(message) { return `<div class="empty">${esc(message)}</div>`; }
function quantity(value, singular, plural = `${singular}s`) { return `${value} ${value === 1 ? singular : plural}`; }
function shortDate(value) { return value ? new Date(value).toLocaleDateString("es-PE") : ""; }
function modernIcon(name) {
  const paths = {
    courses: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>`,
    exams: `<path d="M9 5h10a2 2 0 0 1 2 2v12H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M7 7H5a2 2 0 0 0-2 2v10h14M12 9h5M12 13h5"/>`,
    results: `<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>`,
    course: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>`
  };
  const aliases = { "▦": "courses", "▤": "exams", "✓": "results", "◇": "course" };
  const key = aliases[name] || name;
  return `<svg class="modern-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[key] || paths.course}</svg>`;
}
function stat(label, value, icon, action = "") { return `<button class="stat-card" type="button" data-stat-action="${action}"><span>${modernIcon(icon)}</span><span><strong>${esc(value)}</strong><small>${esc(label)}</small></span></button>`; }
function formatDate(value) { return value ? new Date(value).toLocaleString("es-PE") : "-"; }
function csvCell(value) { return `"${String(value ?? "").replaceAll('"','""')}"`; }
function slug(value) {
  return String(value || "examen").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "examen";
}
function show(id) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === id));
  document.body.classList.toggle("app-shell-mode", ["teacher-view","student-view"].includes(id));
  document.body.classList.toggle("exam-in-progress", id === "exam-view");
  document.body.classList.toggle("student-game-mode", currentUser?.role === "student" && ["student-view","exam-view","result-view"].includes(id));
  document.body.classList.toggle("result-game-mode", id === "result-view");
  document.body.classList.toggle("auth-game-mode", id === "auth-view");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function setSessionMessage(message, type = "muted") {
  $("#session-area").innerHTML = `<span class="${esc(type)} small">${esc(message)}</span>`;
}
function isSupabaseConfigured() {
  const cfg = getSupabaseConfig();
  return Boolean(cfg.url?.startsWith("https://") &&
    cfg.publishableKey?.startsWith("sb_publishable_") &&
    !cfg.url.includes("__") &&
    !cfg.publishableKey.includes("__"));
}
function getSupabaseConfig() {
  const cfg = window.APP_CONFIG || {};
  const legacyUrlKey = ["SUPABASE", "URL"].join("_");
  const legacyKeyName = ["SUPABASE", "PUBLISHABLE", "KEY"].join("_");
  return {
    url: cfg.url || cfg[legacyUrlKey] || "",
    publishableKey: cfg.publishableKey || cfg[legacyKeyName] || ""
  };
}
function initSupabase() {
  if (!isSupabaseConfigured() || !window.supabase?.createClient) return null;
  const cfg = getSupabaseConfig();
  return window.supabase.createClient(
    cfg.url,
    cfg.publishableKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );
}
function translateError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  if (!msg) return "Ocurrió un problema. Inténtalo nuevamente.";
  if (msg.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("email not confirmed")) return "Debes confirmar tu correo antes de ingresar.";
  if (msg.includes("already registered") || msg.includes("user already")) return "Este correo ya está registrado.";
  if (msg.includes("password")) return "La contraseña no cumple los requisitos. Usa mínimo 8 caracteres.";
  if (msg.includes("duplicate key")) return "Ese registro ya existe. No se duplicó.";
  if (msg.includes("row-level security") || msg.includes("permission denied")) return "No tienes permisos para realizar esta acción.";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "No hay conexión o Supabase no respondió.";
  return "No se pudo completar la operación. Revisa los datos e inténtalo otra vez.";
}

async function initApp() {
  bindStaticEvents();
  setSessionMessage("Cargando sesión...");
  $("#login-error").textContent = "";
  $("#register-error").textContent = "";
  if (!isSupabaseConfigured()) {
    const message = "No se configuró la conexión con Supabase. Revisa config.js.";
    $("#login-error").textContent = message;
    $("#register-error").textContent = message;
    setSessionMessage(message, "error");
    await loadCatalogSafe();
    appReady = true;
    renderApp();
    return;
  }
  sb = initSupabase();
  if (!sb) {
    $("#login-error").textContent = "No se pudo cargar la biblioteca de Supabase.";
    setSessionMessage("Supabase no está disponible.", "error");
    appReady = true;
    renderApp();
    return;
  }
  sb.auth.onAuthStateChange(async (_event, session) => {
    if (!appReady) return;
    await setSessionFromSupabase(session, false);
    if (currentUser) await loadCourseChanges();
    renderApp();
  });
  const [{ data: sessionData }, _catalog] = await Promise.all([
    sb.auth.getSession(),
    loadCatalogSafe()
  ]);
  await setSessionFromSupabase(sessionData.session, false);
  if (currentUser) await loadCourseChanges();
  appReady = true;
  await syncPendingResults();
  await refreshResults();
  recoverInterruptedAttempt();
  renderApp();
}

async function setSessionFromSupabase(session, shouldRender = true) {
  if (!session?.user) {
    currentUser = null;
    results = [];
    if (shouldRender) renderApp();
    return;
  }
  try {
    const profile = await fetchProfile(session.user.id);
    currentUser = {
      id: session.user.id,
      name: profile.full_name || session.user.user_metadata?.full_name || session.user.email,
      email: profile.email || session.user.email,
      role: profile.role === "teacher" ? "teacher" : "student"
    };
  } catch (error) {
    console.error("No se pudo recuperar el perfil:", error);
    currentUser = null;
    $("#login-error").textContent = "No se pudo cargar tu perfil. Revisa la configuración de Supabase.";
  }
  if (shouldRender) renderApp();
}

async function fetchProfile(userId) {
  const { data, error } = await sb.from("profiles").select("id, full_name, email, role").eq("id", userId).single();
  if (error) throw error;
  return data;
}

async function loadCatalogSafe() {
  try {
    const response = await fetch(CATALOG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar ${CATALOG_URL}`);
    const raw = await response.json();
    const loaded = await normalizeCatalog(raw);
    catalog = raw;
    catalogCourses = loaded.courses;
    catalogExams = loaded.exams;
    applyCourseChanges();
  } catch (error) {
    console.error("Error cargando catálogo:", error);
    catalog = null;
    catalogCourses = [];
    catalogExams = [];
    publishedCourses = [];
    publishedExams = [];
  }
}

function applyCourseChanges() {
  const changes = new Map(courseChanges.map(change => [change.course_id, change]));
  publishedCourses = catalogCourses.filter(course => !changes.get(course.id)?.deleted).map(course => {
    const change = changes.get(course.id);
    return change ? { ...course, name: change.name || course.name, description: change.description ?? course.description } : course;
  });
  const visibleCourseIds = new Set(publishedCourses.map(course => course.id));
  publishedExams = catalogExams.filter(exam => visibleCourseIds.has(exam.courseId));
}

async function loadCourseChanges() {
  if (!sb || !currentUser) return;
  const { data, error } = await sb.from("course_changes").select("course_id, name, description, deleted, updated_at");
  if (error) {
    console.error("No se pudieron cargar los cambios de cursos:", error);
    courseChanges = [];
  } else courseChanges = data || [];
  applyCourseChanges();
}

async function normalizeCatalog(raw) {
  if (!raw || !Array.isArray(raw.courses)) throw new Error("data/catalog.json no tiene courses.");
  const courseIds = new Set();
  const examIds = new Set();
  const courses = raw.courses.map((course, index) => {
    const id = String(course.id || "").trim();
    if (!id) throw new Error(`Curso ${index + 1} sin id en data/catalog.json.`);
    if (courseIds.has(id)) throw new Error(`ID de curso duplicado: ${id}.`);
    courseIds.add(id);
    return {
      id,
      name: String(course.name || id).trim(),
      description: String(course.description || "").trim(),
      teacherName: String(course.teacher_name || "Profesor").trim(),
      examPaths: Array.isArray(course.exams) ? course.exams : []
    };
  });
  const exams = [];
  for (const course of courses) {
    for (const path of course.examPaths) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rawExam = await response.json();
        const exam = normalizeExam(rawExam, path, course.id);
        if (examIds.has(exam.id)) throw new Error(`ID de examen duplicado: ${exam.id}.`);
        examIds.add(exam.id);
        if (exam.published) exams.push(exam);
      } catch (error) {
        console.error(`Error en ${path}:`, error);
        throw new Error(`Archivo problemático: ${path}. ${error.message}`);
      }
    }
  }
  return { courses, exams };
}

function normalizeQuestionImage(value, questionNumber = "") {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  let image = String(value).trim().replace(/^["']|["']$/g, "");
  const dataImage = image.match(/^data:\s*(image\/[a-z0-9.+-]+)(?:\s*;\s*(?!base64\s*,)[^;,]+)*\s*;\s*base64\s*,([\s\S]+)$/i);
  if (!dataImage) throw new Error(`la imagen${questionNumber ? ` de la pregunta ${questionNumber}` : ""} debe comenzar con data:image/png;base64,`);
  let payload = dataImage[2].replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[a-z0-9+/]+={0,2}$/i.test(payload)) throw new Error(`los datos Base64 de la imagen${questionNumber ? ` de la pregunta ${questionNumber}` : ""} no son válidos.`);
  while (payload.length % 4) payload += "=";
  return `data:${dataImage[1].toLowerCase()};base64,${payload}`;
}
function questionImageMarkup(question, className = "question-image") {
  return question?.image ? `<img class="${className}" src="${esc(question.image)}" alt="Gráfico de la pregunta" loading="lazy">` : "";
}
function normalizeExam(raw, source = "JSON", fallbackCourseId = "") {
  const sourceLabel = source || "JSON";
  const list = Array.isArray(raw) ? raw : raw.questions || raw.preguntas;
  if (!Array.isArray(list)) throw new Error(`${sourceLabel}: no contiene un arreglo de preguntas.`);
  const id = String(raw.id || slug(raw.title || raw.nombre || raw.nombre_examen || "examen")).trim();
  const courseId = String(raw.course_id || raw.courseId || fallbackCourseId || "").trim();
  const title = String(raw.title || raw.nombre || raw.nombre_examen || "Examen sin título").trim();
  const minutes = Number(raw.minutes ?? raw.minutos ?? raw.tiempo ?? 20);
  const questionsToShow = Number(raw.questions_to_show ?? raw.questionsToShow ?? raw.preguntas_a_mostrar ?? Math.min(5, list.length));
  const attemptsAllowed = Number(raw.attempts_allowed ?? raw.attemptsAllowed ?? raw.intentos_permitidos ?? 1);
  const published = raw.published ?? raw.publicado ?? true;
  const optionCount = Number(raw.option_count ?? raw.optionCount ?? raw.opciones_por_pregunta ?? list[0]?.options?.length ?? list[0]?.opciones?.length ?? 5);
  if (!id) throw new Error(`${sourceLabel}: falta id.`);
  if (!courseId) throw new Error(`${sourceLabel}: falta course_id.`);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) throw new Error(`${sourceLabel}: minutes debe estar entre 1 y 300.`);
  if (!Number.isInteger(attemptsAllowed) || attemptsAllowed < 1 || attemptsAllowed > 20) throw new Error(`${sourceLabel}: attempts_allowed debe estar entre 1 y 20.`);
  if (!Number.isInteger(optionCount) || optionCount < 2 || optionCount > 8) throw new Error(`${sourceLabel}: option_count debe estar entre 2 y 8.`);
  if (!Number.isInteger(questionsToShow) || questionsToShow < 1 || questionsToShow > list.length) throw new Error(`${sourceLabel}: questions_to_show debe ser válido y no superar el banco.`);
  const questionIds = new Set();
  const questions = list.map((item, index) => {
    const q = normalizeImportedQuestion(item, index, optionCount);
    if (questionIds.has(q.id)) throw new Error(`${sourceLabel}: ID de pregunta duplicado (${q.id}).`);
    questionIds.add(q.id);
    return q;
  });
  return { id, courseId, title, minutes, questionsToShow, attemptsAllowed, published: published === true || published === "true", optionCount, questions, source };
}
function normalizeImportedQuestion(item, index, forcedOptionCount = null) {
  const text = item.text ?? item.pregunta ?? item.enunciado ?? item.question;
  const image = normalizeQuestionImage(item.image ?? item.imagen ?? "", index + 1);
  let options = item.options ?? item.opciones ?? item.alternativas;
  if (!Array.isArray(options)) {
    options = "ABCDEFGH".split("").map(letter => item[`opcion_${letter.toLowerCase()}`] ?? item[`opcion${letter}`]).filter(value => value !== undefined);
  }
  options = (options || []).map(option => String(option ?? "").trim());
  const optionCount = forcedOptionCount || options.length;
  if (!String(text || "").trim()) throw new Error(`la pregunta ${index + 1} no tiene enunciado.`);
  if (options.length !== optionCount) throw new Error(`la pregunta ${index + 1} debe tener ${optionCount} opciones.`);
  if (options.some(option => !option)) throw new Error(`la pregunta ${index + 1} tiene opciones vacías.`);
  const usesZeroBasedCorrect = Object.prototype.hasOwnProperty.call(item, "correct");
  const answer = item.correct ?? item.respuesta_correcta ?? item.correcta ?? item.answer;
  const correct = normalizeAnswer(answer, options, index, usesZeroBasedCorrect);
  const id = String(item.id || `${slug(String(text).slice(0, 35))}-${index + 1}`).trim();
  return { id, text: String(text).trim(), image, options, correct };
}
function normalizeAnswer(answer, options, index, zeroBasedNumber = false) {
  if (answer === undefined || answer === null || answer === "") throw new Error(`falta respuesta correcta en la pregunta ${index + 1}.`);
  if (typeof answer === "number") {
    if (zeroBasedNumber && answer >= 0 && answer < options.length) return answer;
    if (answer >= 1 && answer <= options.length) return answer - 1;
    if (answer === 0 && options.length) return 0;
  }
  const value = String(answer).trim();
  if (/^[A-H]$/i.test(value)) return value.toUpperCase().charCodeAt(0) - 65;
  if (/^[1-8]$/.test(value)) return Number(value) - 1;
  if (/^[0-7]$/.test(value) && Number(value) < options.length) return Number(value);
  const clean = text => String(text).trim().toLocaleLowerCase("es").replace(/^[a-h]\s*[\)\].:-]\s*/i, "");
  const found = options.findIndex(option => clean(option) === clean(value));
  if (found >= 0) return found;
  throw new Error(`no se reconoce la respuesta correcta de la pregunta ${index + 1}.`);
}

function renderApp() {
  document.body.classList.remove("session-loading");
  if (!currentUser) {
    $("#session-area").innerHTML = `<span class="muted small">Acceso con Supabase</span>`;
    show("auth-view");
    return;
  }
  $("#session-area").innerHTML = `<div class="user-menu"><span class="user-avatar">${esc(currentUser.name.charAt(0).toUpperCase())}</span><span class="user-identity"><strong>${esc(currentUser.name)}</strong><small>${currentUser.role === "teacher" ? "Profesor" : "Alumno"}</small><small class="user-email">${esc(currentUser.email || "")}</small></span><button id="sound-btn" class="btn ghost sound-btn" aria-pressed="${soundEnabled}" title="${soundEnabled ? "Silenciar sonidos" : "Activar sonidos"}">${soundEnabled ? "🔊 Sonido" : "🔇 Silenciado"}</button><button id="profile-btn" class="btn ghost">👤 Mi perfil</button><button id="logout-btn" class="btn ghost logout-btn">↪ Salir</button></div>`;
  $("#sound-btn").addEventListener("click", toggleSound);
  $("#profile-btn").addEventListener("click", openProfile);
  $("#logout-btn").addEventListener("click", logout);
  if (currentUser.role === "teacher") renderTeacher(); else renderStudent();
}

function bindStaticEvents() {
  $("#sidebar-toggle").addEventListener("click", toggleSidebar);
  $("#brand-link").addEventListener("click", event => {
    event.preventDefault();
    if (activeExam && timerInterval) { alert("No puedes salir mientras el examen está activo. Entrégalo para continuar."); return; }
    if (currentUser) renderApp();
  });
  $$(".auth-tab").forEach(button => button.addEventListener("click", () => {
    $$(".auth-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    $("#login-form").classList.toggle("hidden", button.dataset.auth !== "login");
    $("#register-form").classList.toggle("hidden", button.dataset.auth !== "register");
  }));
  bindPasswordToggles();
  $("#register-form").addEventListener("submit", registerUser);
  $("#login-form").addEventListener("submit", loginUser);
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#new-course-btn").addEventListener("click", () => openCourseModal());
  $("#course-search").addEventListener("input", renderTeacherCourseList);
  $("#new-exam-btn").addEventListener("click", () => openExamModal());
  $("#course-form").addEventListener("submit", saveCourseDraft);
  $("#exam-editor-form").addEventListener("submit", saveExamDraft);
  $("#editor-option-count").addEventListener("change", changeOptionCount);
  $("#add-question-btn").addEventListener("click", addBuilderQuestion);
  $("#generate-questions-btn").addEventListener("click", generateQuestions);
  $("#import-questions").addEventListener("change", importQuestions);
  $("#validate-exam-json").addEventListener("click", () => validateCurrentExam(true));
  $("#export-exam-json").addEventListener("click", exportCurrentExam);
  $("#download-template-json").addEventListener("click", downloadTemplateJson);
  $("#copy-catalog-path").addEventListener("click", copyCatalogPath);
  $("#take-exam-form").addEventListener("submit", event => {
    event.preventDefault();
    if (confirm("¿Deseas entregar el examen con tus respuestas actuales?")) finishExam(false);
  });
  $("#return-student").addEventListener("click", () => { activeExam = null; activeQuestions = []; finishingExam = false; renderStudent(); });
  $("#export-grades").addEventListener("click", exportGrades);
  $("#refresh-results").addEventListener("click", async () => { await refreshResults(true); renderTeacher(); });
  ["teacher-search","teacher-course-filter","teacher-exam-filter"].forEach(id => {
    const el = $(`#${id}`);
    if (el) el.addEventListener("input", () => renderTeacherGrades(filteredTeacherResults()));
  });
  $$("[data-teacher-tab]").forEach(button => button.addEventListener("click", () => switchTab("teacher", button.dataset.teacherTab, button)));
  $$("[data-student-tab]").forEach(button => button.addEventListener("click", () => switchTab("student", button.dataset.studentTab, button)));
  $$(".question-mode").forEach(button => button.addEventListener("click", () => setQuestionMode(button.dataset.questionMode)));
  $$(".modal-close").forEach(button => button.addEventListener("click", () => closeModal(button.dataset.close)));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && activeExam && timerInterval) finishExam(false, "El examen se entregó al cambiar de pestaña o minimizar la ventana.", true);
  });
  window.addEventListener("pagehide", () => {
    if (activeExam && timerInterval) finishExam(false, "El examen se entregó al cerrar, recargar o abandonar la página.", true);
  });
  window.addEventListener("beforeunload", saveActiveAttempt);
  window.addEventListener("online", syncPendingResults);
}
function bindPasswordToggles(container = document) {
  container.querySelectorAll(".password-toggle").forEach(button => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.password);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.classList.toggle("is-visible", !showing);
      button.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
      button.title = showing ? "Mostrar contraseña" : "Ocultar contraseña";
    });
  });
}
async function registerUser(event) {
  event.preventDefault();
  if (!sb) { $("#register-error").textContent = "No se configuró la conexión con Supabase. Revisa config.js."; return; }
  const button = event.submitter;
  button.disabled = true;
  const name = $("#register-name").value.trim();
  const email = $("#register-email").value.trim().toLowerCase();
  const password = $("#register-password").value;
  const confirmation = $("#register-password-confirm").value;
  $("#register-error").className = "error";
  $("#register-error").textContent = "";
  try {
    if (password.length < 8) throw new Error("password");
    if (password !== confirmation) { $("#register-error").textContent = "Las contraseñas no coinciden."; return; }
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) throw error;
    if (!data.session) {
      $("#register-error").className = "success";
      $("#register-error").textContent = "Cuenta creada. Revisa tu correo para confirmar el registro.";
      return;
    }
    await setSessionFromSupabase(data.session);
  } catch (error) {
    console.error("Registro:", error);
    $("#register-error").textContent = translateError(error);
  } finally {
    button.disabled = false;
  }
}
async function loginUser(event) {
  event.preventDefault();
  if (!sb) { $("#login-error").textContent = "No se configuró la conexión con Supabase. Revisa config.js."; return; }
  const button = event.submitter;
  button.disabled = true;
  $("#login-error").textContent = "Ingresando...";
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("#login-email").value.trim().toLowerCase(),
      password: $("#login-password").value
    });
    if (error) throw error;
    $("#login-error").textContent = "";
    await setSessionFromSupabase(data.session);
    await syncPendingResults();
    await refreshResults();
    recoverInterruptedAttempt();
    renderApp();
  } catch (error) {
    console.error("Login:", error);
    $("#login-error").textContent = translateError(error);
  } finally {
    button.disabled = false;
  }
}
async function logout() {
  if (timerInterval && !confirm("Hay un examen en curso. Si cierras sesión, se entregará con las respuestas actuales. ¿Deseas continuar?")) return;
  if (timerInterval) await finishExam(false, "Cerraste sesión durante el examen.", true);
  clearInterval(timerInterval);
  timerInterval = null;
  activeExam = null;
  activeQuestions = [];
  if (sb) await sb.auth.signOut({ scope: "local" });
  currentUser = null;
  results = [];
  localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
  renderApp();
}

async function refreshResults(showStatus = false) {
  if (!sb || !currentUser) return;
  const status = $("#teacher-results-status");
  if (showStatus && status) status.textContent = "Cargando resultados...";
  try {
    const { data, error } = await sb.from("results").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    results = (data || []).map(rowToGrade);
    if (showStatus && status) status.textContent = `${quantity(results.length, "resultado")} ${results.length === 1 ? "cargado" : "cargados"}. ${quantity(pendingResults.length, "pendiente local", "pendientes locales")}.`;
  } catch (error) {
    console.error("Resultados:", error);
    if (showStatus && status) status.textContent = translateError(error);
  }
}
function rowToGrade(row) {
  return {
    id: row.submission_id || row.id,
    databaseId: row.id,
    submissionId: row.submission_id,
    studentId: row.student_id,
    studentName: row.student_name,
    studentEmail: row.student_email,
    courseId: row.course_id,
    courseName: row.course_name,
    examId: row.exam_id,
    examTitle: row.exam_title,
    attempt: row.attempt,
    score: Number(row.score),
    correct: row.correct,
    total: row.total,
    answers: row.answers || {},
    questionIds: row.question_ids || [],
    date: row.created_at,
    startedAt: row.started_at,
    secondsUsed: row.seconds_used,
    completionReason: row.completion_reason,
    review: row.answers?.review || []
  };
}

function renderTeacher() {
  show("teacher-view");
  $("#teacher-welcome").textContent = `Hola, ${currentUser.name}`;
  const exams = [...publishedExams, ...drafts.exams];
  $("#teacher-stats").innerHTML =
    stat("Cursos publicados", publishedCourses.length, "courses", "published") +
    stat("Resultados", results.length, "results", "grades");
  $("#courses-tab-count").textContent = publishedCourses.length + drafts.courses.length;
  $("#exams-tab-count").textContent = exams.length;
  $("#grades-tab-count").textContent = results.length;
  renderTeacherCourseList(false);
  $("#teacher-exam-list").innerHTML = exams.length ? exams.map(renderTeacherExamCard).join("") : emptyCard("Todavía no hay exámenes publicados ni borradores locales.");
  fillTeacherFilters();
  renderTeacherGrades(filteredTeacherResults());
  bindTeacherActions();
  $$(".stat-card").forEach(card => card.addEventListener("click", () => activateStat(card.dataset.statAction)));
}
function renderTeacherCourseList(bind = true) {
  $("#teacher-course-list").innerHTML = renderTeacherCourses();
  if (bind) bindTeacherActions();
}
function activateStat(action) {
  if (action === "grades") { const tab = $('[data-teacher-tab="teacher-grades"]'); switchTab("teacher", "teacher-grades", tab); return; }
  switchTab("teacher", "teacher-courses", $('[data-teacher-tab="teacher-courses"]'));
  renderTeacherCourseList();
}
function renderTeacherCourses() {
  const query = ($("#course-search")?.value || "").trim().toLocaleLowerCase("es");
  const matches = (course, state) => !query || `${course.name} ${course.description || ""} ${state}`.toLocaleLowerCase("es").includes(query);
  const published = publishedCourses.map(course => {
    const count = publishedExams.filter(exam => exam.courseId === course.id).length;
    if (!matches(course, "published")) return "";
    const updated = courseChanges.find(change => change.course_id === course.id)?.updated_at;
    return `<article class="course-card compact-course"><div class="course-card-head"><div class="course-icon">${modernIcon("course")}</div><div><h3>${esc(course.name)}</h3><span class="status published">Publicado ✓</span></div></div><p>${esc(course.description || "Sin descripción registrada")}</p><div class="course-meta"><span>${quantity(count, "examen", "exámenes")}</span>${updated ? `<span>Actualizado: ${shortDate(updated)}</span>` : ""}</div><div class="card-actions compact-actions"><button class="btn secondary create-exam-course" data-id="${esc(course.id)}" type="button">Crear examen</button><button class="icon-btn edit-published-course" data-id="${esc(course.id)}" type="button">Editar</button><button class="icon-btn delete delete-published-course" data-id="${esc(course.id)}" type="button">Eliminar</button></div></article>`;
  }).filter(Boolean);
  const local = drafts.courses.map(course => {
    const count = drafts.exams.filter(exam => exam.courseId === course.id).length;
    if (!matches(course, "draft")) return "";
    return `<article class="course-card draft-card compact-course"><div class="course-card-head"><div class="course-icon">${modernIcon("course")}</div><div><h3>${esc(course.name)}</h3><span class="status draft">Borrador local</span></div></div><p>${esc(course.description || "Sin descripción registrada")}</p><div class="course-meta"><span>${count ? quantity(count, "examen", "exámenes") : "Sin exámenes"}</span>${course.updatedAt ? `<span>Actualizado: ${shortDate(course.updatedAt)}</span>` : ""}</div><div class="card-actions compact-actions"><button class="btn primary publish-course" data-id="${esc(course.id)}">Publicar curso</button><button class="btn secondary create-exam-course" data-id="${esc(course.id)}">Crear examen</button><button class="icon-btn edit-course" data-id="${esc(course.id)}">Editar</button><button class="icon-btn delete delete-course" data-id="${esc(course.id)}">Eliminar</button></div></article>`;
  }).filter(Boolean);
  return published.concat(local).join("") || emptyCard("No se encontraron cursos.");
}
function renderTeacherExamCard(exam) {
  const course = findCourse(exam.courseId);
  const isDraft = !publishedExams.some(item => item.id === exam.id);
  return `<article class="course-card ${isDraft ? "draft-card" : ""}"><div class="status ${exam.published ? "published" : ""}">${isDraft ? "Borrador local" : "Publicado"}</div><span class="eyebrow">${esc(course?.name || "Curso no encontrado")}</span><h3>${esc(exam.title)}</h3><p>Banco: ${quantity(exam.questions.length, "pregunta")} · Alumno: ${quantity(exam.questionsToShow, "pregunta")} · ${exam.minutes} minutos · ${quantity(exam.attemptsAllowed, "intento")} · ${exam.optionCount} opciones</p><div class="card-actions">${isDraft ? `<button class="btn secondary edit-exam" data-id="${esc(exam.id)}">Editar</button><button class="btn secondary export-draft" data-id="${esc(exam.id)}">Exportar JSON</button><button class="icon-btn delete delete-exam" data-id="${esc(exam.id)}">Eliminar</button>` : ""}</div></article>`;
}
function bindTeacherActions() {
  $$(".view-course").forEach(button => button.addEventListener("click", () => switchTab("teacher", "teacher-exams", $('[data-teacher-tab="teacher-exams"]'))));
  $$(".create-exam-course").forEach(button => button.addEventListener("click", () => openExamModal(null, button.dataset.id)));
  $$(".edit-course").forEach(button => button.addEventListener("click", () => openCourseModal(button.dataset.id)));
  $$(".delete-course").forEach(button => button.addEventListener("click", () => deleteCourseDraft(button.dataset.id)));
  $$(".edit-published-course").forEach(button => button.addEventListener("click", () => openCourseModal(button.dataset.id)));
  $$(".delete-published-course").forEach(button => button.addEventListener("click", () => deletePublishedCourse(button.dataset.id)));
  $$(".edit-exam").forEach(button => button.addEventListener("click", () => openExamModal(button.dataset.id)));
  $$(".delete-exam").forEach(button => button.addEventListener("click", () => deleteExamDraft(button.dataset.id)));
  $$(".export-draft").forEach(button => button.addEventListener("click", () => { openExamModal(button.dataset.id); setTimeout(exportCurrentExam, 50); }));
  $$(".export-course").forEach(button => button.addEventListener("click", () => exportCourseDraft(button.dataset.id)));
  $$(".publish-course").forEach(button => button.addEventListener("click", () => publishCourseDraft(button.dataset.id, button)));
}
function exportCourseDraft(id) {
  const course = drafts.courses.find(item => item.id === id);
  if (!course) return;
  download(JSON.stringify({ schema_version: 1, id: course.id, name: course.name, description: course.description || "", teacher_name: course.teacherName || currentUser.name }, null, 2), `${slug(course.id)}.json`, "application/json;charset=utf-8");
}
function publishCourseDraft(id, button) {
  const course = drafts.courses.find(item => item.id === id);
  const exams = drafts.exams.filter(exam => exam.courseId === id);
  if (!course) return;
  if (!exams.length) { alert(`El curso ${course.name} necesita al menos un examen antes de preparar su publicación.`); return; }
  button.disabled = true;
  const bundle = {
    schema_version: 1,
    course: { id: course.id, name: course.name, description: course.description || "", teacher_name: course.teacherName || currentUser.name },
    exams: exams.map(examToJsonSchema),
    catalog_entry: {
      id: course.id,
      name: course.name,
      description: course.description || "",
      teacher_name: course.teacherName || currentUser.name,
      exams: exams.map(exam => `./data/exams/${slug(exam.id)}.json`)
    }
  };
  download(JSON.stringify(bundle, null, 2), `${slug(course.id)}-publicacion.json`, "application/json;charset=utf-8");
  button.disabled = false;
  alert(`Se preparó el archivo de publicación de ${course.name}. Súbelo al repositorio y registra sus exámenes en data/catalog.json para que sea visible a los alumnos. El borrador local se conservará hasta confirmar la publicación.`);
}
function fillTeacherFilters() {
  $("#teacher-course-filter").innerHTML = `<option value="">Todos los cursos</option>${publishedCourses.map(course => `<option value="${esc(course.id)}">${esc(course.name)}</option>`).join("")}`;
  $("#teacher-exam-filter").innerHTML = `<option value="">Todos los exámenes</option>${publishedExams.map(exam => `<option value="${esc(exam.id)}">${esc(exam.title)}</option>`).join("")}`;
}
function filteredTeacherResults() {
  const query = ($("#teacher-search")?.value || "").trim().toLowerCase();
  const courseId = $("#teacher-course-filter")?.value || "";
  const examId = $("#teacher-exam-filter")?.value || "";
  return [...results].filter(grade => {
    const text = `${grade.studentName} ${grade.studentEmail}`.toLowerCase();
    return (!query || text.includes(query)) && (!courseId || grade.courseId === courseId) && (!examId || grade.examId === examId);
  }).sort((a, b) => new Date(b.date) - new Date(a.date));
}
function renderTeacherGrades(grades) {
  const students = new Map();
  grades.forEach(grade => {
    const key = grade.studentId || grade.studentEmail || grade.studentName;
    if (!students.has(key)) students.set(key, { name: grade.studentName, grades: [] });
    students.get(key).grades.push(grade);
  });
  $("#teacher-grades-body").innerHTML = students.size ? [...students.values()].map((student, index) => {
    const bestScore = Math.max(...student.grades.map(grade => Number(grade.score) || 0));
    return `<details class="student-result-group"${index === 0 ? " open" : ""}>
      <summary><span class="student-result-avatar" aria-hidden="true">${esc((student.name || "A").charAt(0).toUpperCase())}</span><span class="student-result-name"><strong>${esc(student.name)}</strong><small>${student.grades.length} ${student.grades.length === 1 ? "resultado" : "resultados"}</small></span><span class="student-best-score"><small>Mejor nota</small><strong>${bestScore} / 20</strong></span><span class="student-result-toggle" aria-hidden="true"></span></summary>
      <div class="student-grade-list">${student.grades.map(grade => `<article class="student-grade-row">
        <div class="grade-exam"><small>Evaluación</small><strong>${esc(grade.examTitle)}</strong><span>${esc(grade.courseName)} · Intento ${grade.attempt || 1}</span></div>
        <div><small>Nota</small><strong class="grade">${grade.score} / 20</strong><span>${grade.correct} de ${grade.total} aciertos</span></div>
        <div><small>Tiempo</small><strong>${Math.round((grade.secondsUsed || 0) / 60)} min</strong></div>
        <div class="grade-delivery"><small>Fecha</small><strong>${formatDate(grade.date)}</strong></div>
        <div class="grade-action"><button class="icon-btn delete delete-result" data-id="${esc(grade.databaseId)}" type="button" aria-label="Eliminar resultado de ${esc(student.name)}">Eliminar</button></div>
      </article>`).join("")}</div>
    </details>`;
  }).join("") : emptyCard("Aún no hay resultados.");
  $$(".delete-result").forEach(button => button.addEventListener("click", () => deleteResult(button.dataset.id)));
}
async function deleteResult(databaseId) {
  if (!sb || currentUser?.role !== "teacher") return;
  const grade = results.find(item => item.databaseId === databaseId);
  if (!grade) return;
  if (!confirm(`¿Eliminar definitivamente el intento ${grade.attempt || 1} de ${grade.studentName} en “${grade.examTitle}”?`)) return;
  const status = $("#teacher-results-status");
  if (status) status.textContent = "Eliminando resultado...";
  try {
    const { error } = await sb.from("results").delete().eq("id", databaseId);
    if (error) throw error;
    await refreshResults();
    renderTeacher();
    if (status) status.textContent = "Resultado eliminado correctamente.";
  } catch (error) {
    console.error("Eliminar resultado:", error);
    if (status) status.textContent = `No se pudo eliminar: ${translateError(error)}`;
  }
}
function exportGrades() {
  const rows = [["Alumno","Correo","Curso","Examen","Intento","Nota","Aciertos","Total","Tiempo usado","Motivo","Fecha"], ...filteredTeacherResults().map(g => [g.studentName,g.studentEmail,g.courseName,g.examTitle,g.attempt || 1,g.score,g.correct,g.total,g.secondsUsed || 0,g.completionReason || "",formatDate(g.date)])];
  download(rows.map(row => row.map(csvCell).join(",")).join("\n"), "notas-masterfull.csv", "text/csv;charset=utf-8");
}

function renderStudent() {
  show("student-view");
  $("#student-welcome").textContent = `Hola, ${currentUser.name}`;
  const myGrades = results.filter(grade => grade.studentId === currentUser.id);
  $("#student-stats").innerHTML = stat("Cursos disponibles", new Set(publishedExams.map(exam => exam.courseId)).size, "▦") + stat("Exámenes", publishedExams.length, "▤") + stat("Resultados", myGrades.length, "✓");
  const courses = publishedCourses.filter(course => publishedExams.some(exam => exam.courseId === course.id));
  $("#student-course-list").innerHTML = courses.length ? courses.map(course => {
    const exams = publishedExams.filter(exam => exam.courseId === course.id);
    return `<article class="student-course panel"><div class="course-heading"><div class="course-icon">${modernIcon("course")}</div><div><span class="eyebrow">CURSO</span><h3>${esc(course.name)}</h3><p>${esc(course.description || "Sin descripción")} · Profesor: ${esc(course.teacherName || "Profesor")}</p></div></div><div class="exam-rows">${exams.map(exam => renderStudentExamRow(exam, myGrades)).join("")}</div></article>`;
  }).join("") : emptyCard("Todavía no hay cursos con exámenes publicados.");
  $("#student-grades-body").innerHTML = myGrades.length ? myGrades.map(grade => {
    const exam = publishedExams.find(item => item.id === grade.examId);
    const attemptsUsed = myGrades.filter(item => item.examId === grade.examId).length;
    const canReview = grade.review?.length && attemptsUsed >= (exam?.attemptsAllowed || 1);
    return `<tr><td>${esc(grade.courseName)}</td><td>${esc(grade.examTitle)}</td><td>${grade.attempt || 1}</td><td class="grade">${grade.score} / 20</td><td>${grade.correct} / ${grade.total}</td><td>${formatDate(grade.date)}</td><td>${canReview ? `<button class="icon-btn review-attempt" data-id="${esc(grade.id)}">Ver respuestas</button>` : `<span class="muted small">Al agotar intentos</span>`}</td></tr>`;
  }).join("") : empty("Todavía no has rendido exámenes.", 7);
  $$(".start-exam").forEach(button => button.addEventListener("click", () => startExam(button.dataset.id)));
  $$(".review-exam").forEach(button => button.addEventListener("click", () => showExamReviews(button.dataset.id)));
  $$(".review-attempt").forEach(button => button.addEventListener("click", () => showAttemptReview(button.dataset.id)));
}
function renderStudentExamRow(exam, myGrades) {
  const attempts = myGrades.filter(item => item.examId === exam.id);
  const best = attempts.length ? Math.max(...attempts.map(item => item.score)) : null;
  const reviewButton = attempts.length >= exam.attemptsAllowed && attempts.some(item => item.review?.length) ? `<button class="btn secondary review-exam" data-id="${esc(exam.id)}">Revisar intentos</button>` : "";
  return `<div class="exam-row"><div><strong>${esc(exam.title)}</strong><small>${exam.questionsToShow} preguntas al azar de un banco de ${exam.questions.length} · ${exam.minutes} minutos · Intentos: ${attempts.length}/${exam.attemptsAllowed}</small></div><div class="attempt-actions">${best !== null ? `<span class="completed">Mejor nota: ${best}/20</span>` : ""}${attempts.length < exam.attemptsAllowed ? `<button class="btn primary start-exam" data-id="${esc(exam.id)}">${attempts.length ? "Intentar nuevamente" : "Rendir examen"}</button>` : `<span class="attempts-finished">Intentos completados</span>${reviewButton}`}</div></div>`;
}

async function startExam(id) {
  await refreshResults();
  activeExam = publishedExams.find(exam => exam.id === id);
  if (!activeExam) return;
  const attemptsUsed = results.filter(grade => grade.studentId === currentUser.id && grade.examId === id).length;
  if (attemptsUsed >= activeExam.attemptsAllowed) { alert("Ya utilizaste todos los intentos permitidos para este examen."); renderStudent(); return; }
  activeCourse = findCourse(activeExam.courseId);
  activeQuestions = shuffleQuestions(activeExam.questions).slice(0, activeExam.questionsToShow);
  activeSubmissionId = uid();
  examStartedAt = nowIso();
  secondsLeft = activeExam.minutes * 60;
  minuteWarningPlayed = false;
  finishingExam = false;
  $("#exam-course-name").textContent = activeCourse?.name || "CURSO";
  $("#exam-title").textContent = activeExam.title;
  $("#questions-container").innerHTML = activeQuestions.map((question, index) => `<article class="question-card"><span class="question-number">PREGUNTA ${index + 1} DE ${activeQuestions.length}</span><h3>${esc(question.text)}</h3>${questionImageMarkup(question)}${question.options.map((option, i) => `<label class="option"><input type="radio" name="q-${esc(question.id)}" value="${i}"><span>${esc(option)}</span></label>`).join("")}</article>`).join("");
  $("#take-exam-form").querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener("change", () => { updateExamProgress(); saveActiveAttempt(); }));
  updateTimer();
  updateExamProgress();
  saveActiveAttempt();
  show("exam-view");
  playRetroSound("start");
  timerInterval = setInterval(() => { secondsLeft--; updateTimer(); if (secondsLeft <= 0) finishExam(true); }, 1000);
}
function shuffleQuestions(questions) {
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}
function updateTimer() {
  $("#timer").textContent = `${String(Math.floor(secondsLeft / 60)).padStart(2,"0")}:${String(secondsLeft % 60).padStart(2,"0")}`;
  $(".timer").classList.toggle("danger", secondsLeft <= 60);
  if (secondsLeft === 60 && !minuteWarningPlayed) {
    minuteWarningPlayed = true;
    setTimeout(() => playRetroSound("warning"), 650);
  }
  if (secondsLeft % 5 === 0) saveActiveAttempt();
}
function getCurrentAnswers() {
  return Object.fromEntries(activeQuestions.map(question => {
    const selected = document.querySelector(`input[name="q-${CSS.escape(question.id)}"]:checked`);
    return [question.id, selected ? Number(selected.value) : null];
  }));
}
function updateExamProgress() {
  const answered = Object.values(getCurrentAnswers()).filter(value => value !== null).length;
  $("#exam-progress").textContent = `${answered} de ${activeQuestions.length} respondidas`;
}
function saveActiveAttempt() {
  if (!activeExam || finishingExam || !currentUser) return;
  localStorage.setItem(ACTIVE_ATTEMPT_KEY, JSON.stringify({
    submissionId: activeSubmissionId,
    userId: currentUser.id,
    examId: activeExam.id,
    startedAt: examStartedAt,
    secondsLeft,
    questions: activeQuestions,
    answers: getCurrentAnswers()
  }));
}
function gradeExam(questions, answers) {
  let correct = 0;
  const review = questions.map(question => {
    const selected = answers[question.id] ?? null;
    const isCorrect = selected === question.correct;
    if (isCorrect) correct++;
    return { id: question.id, text: question.text, image: question.image || "", options: [...question.options], correct: question.correct, selected };
  });
  const total = questions.length;
  return { correct, total, score: Math.round((correct / total) * 200) / 10, review };
}
async function finishExam(timeExpired, reason = "", silent = false) {
  if (!activeExam || finishingExam || !currentUser) return;
  finishingExam = true;
  clearInterval(timerInterval);
  timerInterval = null;
  const answers = getCurrentAnswers();
  const grade = gradeExam(activeQuestions, answers);
  const previous = results.filter(item => item.studentId === currentUser.id && item.examId === activeExam.id).length;
  const payload = {
    submission_id: activeSubmissionId || uid(),
    student_id: currentUser.id,
    student_name: currentUser.name,
    student_email: currentUser.email,
    course_id: activeExam.courseId,
    course_name: activeCourse?.name || "",
    exam_id: activeExam.id,
    exam_title: activeExam.title,
    attempt: previous + 1,
    score: grade.score,
    correct: grade.correct,
    total: grade.total,
    answers: { selected: answers, review: grade.review },
    question_ids: activeQuestions.map(question => question.id),
    started_at: examStartedAt,
    seconds_used: Math.max(0, activeExam.minutes * 60 - secondsLeft),
    completion_reason: reason || (timeExpired ? "El tiempo terminó." : "Entregado por el alumno."),
    created_at: nowIso()
  };
  enqueuePending(payload);
  if (silent) sendResultKeepalive(payload);
  const saved = silent ? false : await syncOneResult(payload);
  if (saved) removePending(payload.submission_id);
  localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
  await refreshResults();
  const rowGrade = rowToGrade(payload);
  if (!silent) playRetroSound("finish");
  if (!silent) {
    const attemptsFinished = payload.attempt >= activeExam.attemptsAllowed;
    renderExamResult(rowGrade, attemptsFinished, saved);
    if (attemptsFinished) {
      const completedGrades = [...results.filter(item => item.examId === activeExam.id && item.studentId === currentUser.id && item.review?.length), rowGrade].filter((item, idx, arr) => arr.findIndex(other => other.submissionId === item.submissionId) === idx);
      $("#result-review").innerHTML = `<h3 class="review-heading">Revisión de todos tus intentos</h3>${reviewMarkup(completedGrades)}`;
    }
  }
}
function enqueuePending(payload) {
  if (!pendingResults.some(item => item.submission_id === payload.submission_id)) {
    pendingResults.push(payload);
    savePending();
  }
}
function removePending(submissionId) {
  pendingResults = pendingResults.filter(item => item.submission_id !== submissionId);
  savePending();
}
async function syncOneResult(payload) {
  if (!sb || !navigator.onLine) return false;
  try {
    const { error } = await sb.from("results").insert(payload);
    if (error) {
      if (String(error.code) === "23505" || String(error.message).toLowerCase().includes("duplicate")) return true;
      throw error;
    }
    return true;
  } catch (error) {
    console.error("No se pudo guardar resultado:", error);
    return false;
  }
}
async function syncPendingResults() {
  if (!sb || !currentUser || !pendingResults.length || !navigator.onLine) return;
  for (const payload of [...pendingResults]) {
    const ok = await syncOneResult(payload);
    if (ok) removePending(payload.submission_id);
  }
  await refreshResults();
  if (currentUser) renderApp();
}
async function sendResultKeepalive(payload) {
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const cfg = getSupabaseConfig();
    fetch(`${cfg.url}/rest/v1/results`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: cfg.publishableKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates"
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (error) {
    console.error("keepalive:", error);
  }
}
function renderExamResult(grade, includeReview = false, saved = false) {
  $("#result-score").textContent = grade.score;
  $("#result-message").textContent = `${grade.correct} de ${grade.total} respuestas correctas. ${grade.completionReason || ""}`;
  $("#result-encouragement").textContent = `${encouragementFor(grade.score)} ${saved ? "Resultado guardado correctamente." : "Resultado pendiente de sincronización."}`;
  $("#result-review").innerHTML = includeReview ? reviewMarkup([grade]) : "";
  show("result-view");
}
function encouragementFor(score) {
  if (score >= 18) return "¡Excelente trabajo! Tu esfuerzo y preparación se notan.";
  if (score >= 14) return "¡Muy buen trabajo! Sigue practicando y llegarás todavía más lejos.";
  if (score >= 11) return "¡Vas por buen camino! Cada intento fortalece lo que estás aprendiendo.";
  return "No te rindas. Revisar tus respuestas es el primer paso para mejorar.";
}
function reviewMarkup(grades) {
  return `<div class="attempt-review-list">${grades.map(grade => `<section class="attempt-review"><div class="attempt-review-head"><div><span class="eyebrow">INTENTO ${grade.attempt || 1}</span><h3>${esc(grade.examTitle)}</h3></div><strong>${grade.score}/20</strong></div>${(grade.review || []).map((question, index) => {
    const answeredCorrectly = question.selected === question.correct;
    return `<article class="review-question ${answeredCorrectly ? "review-correct" : "review-incorrect"}"><div class="review-question-title"><span>${answeredCorrectly ? "✓ Correcta" : "✕ Incorrecta"}</span><strong>Pregunta ${index + 1}</strong></div><h4>${esc(question.text)}</h4>${questionImageMarkup(question, "review-image")}<div>${question.options.map((option, optionIndex) => {
      const classes = ["review-option"];
      if (optionIndex === question.correct) classes.push("correct-answer");
      if (optionIndex === question.selected && optionIndex !== question.correct) classes.push("wrong-answer");
      const marker = optionIndex === question.correct ? "✓" : optionIndex === question.selected ? "✕" : "○";
      return `<div class="${classes.join(" ")}"><span>${marker}</span><span>${esc(option)}</span>${optionIndex === question.correct ? "<small>Respuesta correcta</small>" : optionIndex === question.selected ? "<small>Tu respuesta</small>" : ""}</div>`;
    }).join("")}</div>${question.selected === null ? `<p class="unanswered">No respondiste esta pregunta.</p>` : ""}</article>`;
  }).join("")}</section>`).join("")}</div>`;
}
function showAttemptReview(gradeId) {
  const grade = results.find(item => item.id === gradeId && item.studentId === currentUser.id);
  if (grade?.review?.length) renderExamResult(grade, true, true);
}
function showExamReviews(examId) {
  const grades = results.filter(item => item.examId === examId && item.studentId === currentUser.id && item.review?.length).sort((a, b) => (a.attempt || 1) - (b.attempt || 1));
  if (!grades.length) return;
  const best = grades.reduce((current, grade) => grade.score > current.score ? grade : current, grades[0]);
  renderExamResult(best, false, true);
  $("#result-message").textContent = `${grades.length} ${grades.length === 1 ? "intento completado" : "intentos completados"}. Aquí puedes revisar todas tus respuestas.`;
  $("#result-review").innerHTML = reviewMarkup(grades);
}
function recoverInterruptedAttempt() {
  if (!currentUser) return;
  let draft;
  try { draft = JSON.parse(localStorage.getItem(ACTIVE_ATTEMPT_KEY)); } catch { localStorage.removeItem(ACTIVE_ATTEMPT_KEY); return; }
  if (!draft || draft.userId !== currentUser.id || !Array.isArray(draft.questions) || !draft.questions.length) return;
  const exam = publishedExams.find(item => item.id === draft.examId);
  if (!exam) { localStorage.removeItem(ACTIVE_ATTEMPT_KEY); return; }
  activeExam = exam;
  activeCourse = findCourse(exam.courseId);
  activeQuestions = draft.questions;
  activeSubmissionId = draft.submissionId || uid();
  examStartedAt = draft.startedAt;
  secondsLeft = draft.secondsLeft || 0;
  const grade = gradeExam(activeQuestions, draft.answers || {});
  const previous = results.filter(item => item.studentId === currentUser.id && item.examId === exam.id).length;
  enqueuePending({
    submission_id: activeSubmissionId,
    student_id: currentUser.id,
    student_name: currentUser.name,
    student_email: currentUser.email,
    course_id: exam.courseId,
    course_name: activeCourse?.name || "",
    exam_id: exam.id,
    exam_title: exam.title,
    attempt: previous + 1,
    score: grade.score,
    correct: grade.correct,
    total: grade.total,
    answers: { selected: draft.answers || {}, review: grade.review },
    question_ids: activeQuestions.map(question => question.id),
    started_at: examStartedAt,
    seconds_used: Math.max(0, exam.minutes * 60 - (draft.secondsLeft || 0)),
    completion_reason: "El examen se registró al detectar que la página se cerró inesperadamente.",
    created_at: nowIso()
  });
  localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
  activeExam = null;
  syncPendingResults();
}

function findCourse(id) {
  return publishedCourses.find(course => course.id === id) || drafts.courses.find(course => course.id === id);
}
function switchTab(prefix, id, button) {
  $$(`[data-${prefix}-tab]`).forEach(tab => tab.classList.toggle("active", tab === button));
  document.querySelectorAll(`#${prefix}-view .tab-content`).forEach(content => content.classList.toggle("active", content.id === id));
}
function openCourseModal(id = "") {
  const localCourse = drafts.courses.find(item => item.id === id);
  const publishedCourse = publishedCourses.find(item => item.id === id);
  const course = localCourse || publishedCourse;
  $("#course-modal-title").textContent = publishedCourse ? "Editar curso publicado" : localCourse ? "Editar curso local" : "Crear curso local";
  $("#course-id").value = course?.id || "";
  $("#course-name").value = course?.name || "";
  $("#course-description").value = course?.description || "";
  $("#course-error").textContent = "";
  $("#course-modal").classList.remove("hidden");
  $("#course-name").focus();
}
function toggleSidebar() {
  const mobile = matchMedia("(max-width: 900px)").matches;
  const visible = mobile ? document.body.classList.toggle("sidebar-open") : !document.body.classList.toggle("sidebar-collapsed");
  $("#sidebar-toggle").setAttribute("aria-expanded", String(visible));
  $("#sidebar-toggle").setAttribute("aria-label", visible ? "Ocultar barra lateral" : "Mostrar barra lateral");
}
async function saveCourseDraft(event) {
  event.preventDefault();
  const id = $("#course-id").value;
  const course = { id: id || slug($("#course-name").value), name: $("#course-name").value.trim(), description: $("#course-description").value.trim(), teacherName: currentUser.name, local: true, updatedAt: nowIso() };
  if (id && publishedCourses.some(item => item.id === id)) {
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    $("#course-error").textContent = "";
    const { error } = await sb.from("course_changes").upsert({ course_id: id, name: course.name, description: course.description, deleted: false, updated_by: currentUser.id }, { onConflict: "course_id" });
    if (submit) submit.disabled = false;
    if (error) {
      console.error("Editar curso publicado:", error);
      $("#course-error").textContent = translateError(error);
      return;
    }
    await loadCourseChanges();
    closeModal("course-modal");
    renderTeacher();
    return;
  }
  if (id) drafts.courses = drafts.courses.map(item => item.id === id ? { ...item, ...course } : item); else drafts.courses.push(course);
  saveDrafts();
  closeModal("course-modal");
  renderTeacher();
}

async function deletePublishedCourse(id) {
  if (!sb || currentUser?.role !== "teacher") return;
  const course = publishedCourses.find(item => item.id === id);
  if (!course) return;
  const examCount = publishedExams.filter(exam => exam.courseId === id).length;
  if (!confirm(`¿Deseas eliminar el curso ${course.name}?\nEl curso dejará de mostrarse a los alumnos${examCount ? ` junto con ${quantity(examCount, "examen", "exámenes")}` : ""}, pero las notas anteriores y los resultados existentes se conservarán.`)) return;
  const { error } = await sb.from("course_changes").upsert({ course_id: id, name: course.name, description: course.description || "", deleted: true, updated_by: currentUser.id }, { onConflict: "course_id" });
  if (error) {
    console.error("Eliminar curso publicado:", error);
    alert(translateError(error));
    return;
  }
  await loadCourseChanges();
  renderTeacher();
}
function deleteCourseDraft(id) {
  const examCount = drafts.exams.filter(exam => exam.courseId === id).length;
  if (!confirm(`¿Eliminar este curso local${examCount ? ` y ${quantity(examCount, "examen", "exámenes")}` : ""}?`)) return;
  drafts.courses = drafts.courses.filter(course => course.id !== id);
  drafts.exams = drafts.exams.filter(exam => exam.courseId !== id);
  saveDrafts();
  renderTeacher();
}
function openExamModal(id = null, courseId = null) {
  const courses = [...publishedCourses, ...drafts.courses];
  if (!courses.length) { alert("Primero crea un curso local o agrega cursos en data/catalog.json."); openCourseModal(); return; }
  const exam = drafts.exams.find(item => item.id === id);
  $("#exam-modal-title").textContent = exam ? "Editar borrador de examen" : "Crear borrador de examen";
  $("#editor-exam-id").value = exam?.id || "";
  $("#editor-course").innerHTML = courses.map(course => `<option value="${esc(course.id)}">${esc(course.name)}</option>`).join("");
  $("#editor-course").value = exam?.courseId || courseId || courses[0].id;
  $("#editor-title").value = exam?.title || "";
  $("#editor-minutes").value = exam?.minutes || 20;
  $("#editor-question-count").value = exam?.questionsToShow || 5;
  $("#editor-attempts").value = exam?.attemptsAllowed || 1;
  builderOptionCount = exam?.optionCount || exam?.questions?.[0]?.options?.length || 5;
  $("#editor-option-count").value = String(builderOptionCount);
  $("#editor-published").value = String(exam?.published ?? true);
  builderQuestions = structuredClone(exam?.questions || []);
  renderBuilder();
  setQuestionMode("manual-panel");
  $("#exam-editor-error").textContent = "";
  $("#exam-modal").classList.remove("hidden");
}
function changeOptionCount() {
  collectBuilder();
  builderOptionCount = Number($("#editor-option-count").value);
  let resetAnswers = 0;
  builderQuestions.forEach(question => {
    question.options = Array.from({ length: builderOptionCount }, (_, index) => question.options[index] ?? "");
    if (question.correct >= builderOptionCount) { question.correct = 0; resetAnswers++; }
  });
  renderBuilder();
  $("#option-count-message").textContent = `Todas las preguntas usarán ${builderOptionCount} opciones.${resetAnswers ? ` Se reinició la respuesta correcta de ${quantity(resetAnswers, "pregunta")}.` : ""}`;
}
function setQuestionMode(panelId) {
  $$(".question-mode").forEach(button => button.classList.toggle("active", button.dataset.questionMode === panelId));
  $$(".question-tool-panel").forEach(panel => panel.classList.toggle("active", panel.id === panelId));
}
function addBuilderQuestion() {
  collectBuilder();
  const question = { id: uid(), text: "", image: "", options: Array(builderOptionCount).fill(""), correct: 0 };
  builderQuestions.push(question);
  renderBuilder();
}
function generateQuestions() {
  collectBuilder();
  const facts = $("#generator-content").value.split(/\r?\n/).map(line => {
    const separator = line.search(/[:=]/);
    if (separator < 1) return null;
    return { concept: line.slice(0, separator).trim(), definition: line.slice(separator + 1).trim() };
  }).filter(fact => fact?.concept && fact?.definition);
  if (facts.length < 2) {
    $("#generator-message").textContent = "Escribe al menos dos líneas con el formato concepto: definición.";
    return;
  }
  const amount = Math.min(Number($("#generator-count").value) || 1, facts.length);
  const fallbacks = ["Ninguna de las anteriores", "Todas las anteriores", "No se puede determinar", "Información insuficiente", "La afirmación es falsa", "La afirmación es verdadera", "No corresponde"];
  facts.slice(0, amount).forEach((fact, factIndex) => {
    const distractors = facts.filter((_, index) => index !== factIndex).map(item => item.definition);
    const alternatives = [...new Set([fact.definition, ...distractors, ...fallbacks])].slice(0, builderOptionCount);
    while (alternatives.length < builderOptionCount) alternatives.push(`Opción ${alternatives.length + 1}`);
    builderQuestions.push({ id: uid(), text: `¿Cuál es la definición correcta de ${fact.concept}?`, image: "", options: alternatives, correct: 0 });
  });
  $("#generator-message").textContent = "";
  renderBuilder();
}
async function importQuestions(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const json = JSON.parse(cleaned);
    const list = Array.isArray(json) ? json : json.questions || json.preguntas;
    if (!Array.isArray(list)) throw new Error("El archivo no contiene preguntas.");
    const detectedCount = list[0]?.options?.length || list[0]?.opciones?.length || builderOptionCount;
    if (!builderQuestions.length && detectedCount >= 2 && detectedCount <= 8) {
      builderOptionCount = detectedCount;
      $("#editor-option-count").value = String(builderOptionCount);
    }
    const imported = list.map((item, index) => normalizeImportedQuestion(item, index, builderOptionCount));
    builderQuestions = [...builderQuestions, ...imported];
    $("#import-message").className = "success";
    $("#import-message").textContent = `Se importaron ${quantity(imported.length, "pregunta")}.`;
    renderBuilder();
  } catch (error) {
    console.error("Importación:", error);
    $("#import-message").className = "error";
    $("#import-message").textContent = `Archivo no válido: ${error.message}`;
  } finally {
    event.target.value = "";
  }
}
function renderBuilder() {
  $("#builder-count").textContent = builderQuestions.length;
  $("#question-builder").innerHTML = builderQuestions.length ? builderQuestions.map((question, index) => `
    <article class="builder-question" data-qid="${esc(question.id)}">
      <div class="builder-title"><strong>Pregunta ${index + 1} <small>· editable</small></strong><button class="icon-btn delete remove-builder-question" type="button" data-id="${esc(question.id)}">Eliminar</button></div>
      <label>Enunciado<textarea class="b-text" rows="2" placeholder="Escribe la pregunta" required>${esc(question.text)}</textarea></label>
      ${questionImageMarkup(question, "builder-question-image")}
      <div class="options-grid">${question.options.map((option, i) => `<label>Opción ${"ABCDEFGH"[i]}<input class="b-option" data-index="${i}" value="${esc(option)}" required></label>`).join("")}</div>
      <label>Respuesta correcta<select class="b-correct">${question.options.map((_, i) => `<option value="${i}" ${question.correct === i ? "selected" : ""}>Opción ${"ABCDEFGH"[i]}</option>`).join("")}</select></label>
    </article>`).join("") : `<div class="empty">Agrega por lo menos una pregunta.</div>`;
  $$(".remove-builder-question").forEach(button => button.addEventListener("click", () => {
    collectBuilder();
    builderQuestions = builderQuestions.filter(question => question.id !== button.dataset.id);
    renderBuilder();
  }));
}
function collectBuilder() {
  $$(".builder-question").forEach(card => {
    const question = builderQuestions.find(item => item.id === card.dataset.qid);
    if (!question) return;
    question.text = card.querySelector(".b-text").value.trim();
    question.options = [...card.querySelectorAll(".b-option")].map(input => input.value.trim());
    question.correct = Number(card.querySelector(".b-correct").value);
  });
}
function buildExamFromEditor() {
  collectBuilder();
  const title = $("#editor-title").value.trim();
  const id = $("#editor-exam-id").value || slug(`${$("#editor-course").value}-${title || "examen"}`);
  return normalizeExam({
    schema_version: 1,
    id,
    course_id: $("#editor-course").value,
    title,
    minutes: Number($("#editor-minutes").value),
    questions_to_show: Number($("#editor-question-count").value),
    attempts_allowed: Number($("#editor-attempts").value),
    published: $("#editor-published").value === "true",
    option_count: builderOptionCount,
    questions: builderQuestions
  }, "borrador del editor", $("#editor-course").value);
}
function validateCurrentExam(showMessage = false) {
  try {
    const exam = buildExamFromEditor();
    if (showMessage) {
      $("#exam-editor-error").className = "success";
      $("#exam-editor-error").textContent = `JSON válido. Ruta sugerida: ./data/exams/${slug(exam.id)}.json`;
    }
    return exam;
  } catch (error) {
    $("#exam-editor-error").className = "error";
    $("#exam-editor-error").textContent = error.message;
    return null;
  }
}
function saveExamDraft(event) {
  event.preventDefault();
  const exam = validateCurrentExam(false);
  if (!exam) return;
  const id = $("#editor-exam-id").value;
  if (id) drafts.exams = drafts.exams.map(item => item.id === id ? exam : item); else drafts.exams.push(exam);
  saveDrafts();
  closeModal("exam-modal");
  renderTeacher();
}
function deleteExamDraft(id) {
  if (!confirm("¿Eliminar este borrador local?")) return;
  drafts.exams = drafts.exams.filter(exam => exam.id !== id);
  saveDrafts();
  renderTeacher();
}
function examToJsonSchema(exam) {
  return {
    schema_version: 1,
    id: exam.id,
    course_id: exam.courseId,
    title: exam.title,
    minutes: exam.minutes,
    questions_to_show: exam.questionsToShow,
    attempts_allowed: exam.attemptsAllowed,
    published: exam.published,
    option_count: exam.optionCount,
    questions: exam.questions.map(q => ({ id: q.id, text: q.text, image: q.image || "", options: q.options, correct: q.correct }))
  };
}
function exportCurrentExam() {
  const exam = validateCurrentExam(false);
  if (!exam) return;
  download(JSON.stringify(examToJsonSchema(exam), null, 2), `${slug(exam.id)}.json`, "application/json;charset=utf-8");
}
function downloadTemplateJson() {
  const courseId = $("#editor-course").value || "fisica";
  const template = examToJsonSchema(normalizeExam({
    id: `${courseId}-nuevo-examen`,
    course_id: courseId,
    title: "Nuevo examen",
    minutes: 20,
    questions_to_show: 1,
    attempts_allowed: 1,
    published: true,
    option_count: 5,
    questions: [{ id: "pregunta-001", text: "Escribe aquí la pregunta", image: "", options: ["Opción A","Opción B","Opción C","Opción D","Opción E"], correct: 0 }]
  }, "plantilla", courseId));
  download(JSON.stringify(template, null, 2), "plantilla-examen.json", "application/json;charset=utf-8");
}
async function copyCatalogPath() {
  const exam = validateCurrentExam(false);
  if (!exam) return;
  const path = `./data/exams/${slug(exam.id)}.json`;
  try {
    await navigator.clipboard.writeText(path);
    $("#exam-editor-error").className = "success";
    $("#exam-editor-error").textContent = `Ruta copiada: ${path}`;
  } catch {
    $("#exam-editor-error").className = "success";
    $("#exam-editor-error").textContent = `Ruta para catalog.json: ${path}`;
  }
}
function closeModal(id) { $(`#${id}`).classList.add("hidden"); }

async function openProfile() {
  if (!currentUser) return;
  $("#profile-name").value = currentUser.name;
  $("#profile-email").value = currentUser.email;
  $("#profile-role").value = currentUser.role === "teacher" ? "Profesor" : "Alumno";
  $("#profile-current-password").value = "";
  $("#profile-new-password").value = "";
  $("#profile-confirm-password").value = "";
  $("#profile-message").textContent = "";
  $("#profile-message").className = "";
  $("#profile-modal").classList.remove("hidden");
  bindPasswordToggles($("#profile-modal"));
  $("#profile-name").focus();
}
async function saveProfile(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const message = $("#profile-message");
  message.className = "error";
  message.textContent = "";
  try {
    const name = $("#profile-name").value.trim();
    const email = $("#profile-email").value.trim().toLowerCase();
    const currentPassword = $("#profile-current-password").value;
    const newPassword = $("#profile-new-password").value;
    const confirmation = $("#profile-confirm-password").value;
    if (newPassword || confirmation || currentPassword) {
      if (!currentPassword) throw new Error("Escribe tu contraseña actual para cambiarla.");
      if (newPassword.length < 8) throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
      if (newPassword !== confirmation) throw new Error("Las nuevas contraseñas no coinciden.");
      const { error: reauthError } = await sb.auth.signInWithPassword({ email: currentUser.email, password: currentPassword });
      if (reauthError) throw new Error("La contraseña actual es incorrecta.");
      const { error: passError } = await sb.auth.updateUser({ password: newPassword });
      if (passError) throw passError;
    }
    const updates = { data: { full_name: name } };
    if (email !== currentUser.email) updates.email = email;
    const { error: authError } = await sb.auth.updateUser(updates);
    if (authError) throw authError;
    const { error: profileError } = await sb.from("profiles").update({ full_name: name, email }).eq("id", currentUser.id);
    if (profileError) throw profileError;
    currentUser = { ...currentUser, name, email };
    message.className = "success";
    message.textContent = email !== currentUser.email ? "Perfil actualizado. Supabase puede pedir confirmación del nuevo correo." : "Perfil actualizado correctamente.";
    renderApp();
    $("#profile-modal").classList.remove("hidden");
    $("#profile-message").className = "success";
    $("#profile-message").textContent = "Perfil actualizado correctamente. Si cambiaste el correo, revisa la confirmación de Supabase.";
  } catch (error) {
    console.error("Perfil:", error);
    message.textContent = error.message || translateError(error);
  } finally {
    button.disabled = false;
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, String(soundEnabled));
  if (soundEnabled) playRetroSound("toggle");
  renderApp();
}
function playRetroSound(kind) {
  if (!soundEnabled) return;
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) return;
  audioContext ||= new AudioEngine();
  if (audioContext.state === "suspended") audioContext.resume();
  const melodies = {
    start: [[523,0,.09],[659,.1,.09],[784,.2,.11],[1047,.32,.17]],
    warning: [[988,0,.09],[784,.13,.09],[988,.26,.09],[784,.39,.09],[1175,.52,.2]],
    finish: [[659,0,.1],[784,.11,.1],[988,.22,.1],[1319,.34,.25]],
    toggle: [[784,0,.08],[1047,.09,.12]]
  };
  const now = audioContext.currentTime;
  (melodies[kind] || melodies.toggle).forEach(([frequency, delay, duration]) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, now + delay);
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.12, now + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + duration + 0.02);
  });
}
function download(content, filename, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\uFEFF" + content], { type }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

initApp().catch(error => {
  console.error("No se pudo iniciar la plataforma:", error);
  document.body.classList.remove("session-loading");
  if (currentUser) renderApp();
  else {
    show("auth-view");
    setSessionMessage("No se pudo iniciar la plataforma.", "error");
  }
});
