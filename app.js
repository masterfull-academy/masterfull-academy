const DRAFT_KEY = "aulaquiz_local_drafts_v1";
const ACTIVE_ATTEMPT_KEY = "aulaquiz_active_attempt_v2";
const PENDING_RESULTS_KEY = "aulaquiz_pending_results_v1";
const SOUND_KEY = "aulaquiz_sound_enabled_v1";
const COURSE_PROGRESS_KEY = "masterfull_course_progress_v1";
const CATALOG_URL = "./data/catalog.json";
const LEGACY_MODULE_ROW_PREFIX = "__mfmod__:";

const emptyDrafts = { courses: [], exams: [] };
let drafts = load(DRAFT_KEY, emptyDrafts);
let pendingResults = load(PENDING_RESULTS_KEY, []);
let sb = null;
let currentUser = null;
let catalog = null;
let catalogCourses = [];
let catalogExams = [];
let dynamicCourses = [];
let dynamicExams = [];
let courseChanges = [];
let legacyCourseModules = new Map();
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
let publishingCourseId = null;
let builderQuestions = [];
let builderOptionCount = 5;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== "false";
let courseProgress = load(COURSE_PROGRESS_KEY, {});
let audioContext = null;
let authTransitionPending = false;
let minuteWarningPlayed = false;
let appReady = false;
let activeTeacherCourseId = null;
let activeTeacherCourseSection = "overview";
let activeTeacherWorkspaceOrigin = "exams";
let activeStudentCourseId = null;
let activeLessonCourseId = null;
let activeLessonActivityId = null;
let activeLessonTab = "description";

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
function saveCourseProgress() { localStorage.setItem(COURSE_PROGRESS_KEY, JSON.stringify(courseProgress)); }
function normalizeModules(value) {
  if (!Array.isArray(value)) return [];
  return value.map((module, moduleIndex) => ({
    id: String(module.id || `module-${moduleIndex + 1}`),
    title: String(module.title || module.name || `Módulo ${moduleIndex + 1}`).trim(),
    unlockRule: ["immediate","previous","evaluation","date"].includes(module.unlockRule || module.unlock_rule) ? (module.unlockRule || module.unlock_rule) : "immediate",
    unlockDetail: String(module.unlockDetail || module.unlock_detail || "").trim(),
    activities: (Array.isArray(module.activities) ? module.activities : []).map((activity, activityIndex) => ({
      id: String(activity.id || `activity-${moduleIndex + 1}-${activityIndex + 1}`),
      title: String(activity.title || activity.name || `Actividad ${activityIndex + 1}`).trim(),
      type: ["page","lesson","video","pdf","download","task","quiz","link"].includes(activity.type) ? activity.type : "lesson",
      url: String(activity.url || "").trim(),
      description: String(activity.description || "").trim()
    }))
  }));
}
function legacyModuleHash(value) {
  let first = 2166136261;
  let second = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8,"0")}${(second >>> 0).toString(16).padStart(8,"0")}`;
}
function legacyModulePrefix(courseId) { return `${LEGACY_MODULE_ROW_PREFIX}${legacyModuleHash(String(courseId))}:`; }
function isLegacyModuleRow(row) { return String(row?.course_id || "").startsWith(LEGACY_MODULE_ROW_PREFIX); }
function decodeLegacyModuleRows(rows, courses) {
  const decoded = new Map();
  const available = rows.filter(row => isLegacyModuleRow(row) && !row.deleted);
  courses.forEach(course => {
    const prefix = legacyModulePrefix(course.id);
    const chunks = available.filter(row => row.course_id.startsWith(prefix)).sort((left, right) => left.course_id.localeCompare(right.course_id));
    if (!chunks.length) return;
    try { decoded.set(course.id, normalizeModules(JSON.parse(chunks.map(row => row.description || "").join("")))); }
    catch (error) { console.error(`Módulos compatibles dañados para ${course.id}:`, error); }
  });
  return decoded;
}
function isMissingModulesColumn(error) {
  const detail = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return detail.includes("42703") || detail.includes("pgrst204") || (detail.includes("modules") && (detail.includes("column") || detail.includes("schema cache")));
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[char]));
}
function empty(message, colspan = 1) { return `<tr><td colspan="${colspan}" class="empty">${esc(message)}</td></tr>`; }
function emptyCard(message) { return `<div class="empty">${esc(message)}</div>`; }
function quantity(value, singular, plural = `${singular}s`) { return `${value} ${value === 1 ? singular : plural}`; }
function shortDate(value) { return value ? new Date(value).toLocaleDateString("es-PE") : ""; }
function formatDateOnly(value) { return value ? new Date(value).toLocaleDateString("es-PE", { day:"2-digit", month:"2-digit", year:"numeric" }) : "-"; }
function formatTimeOnly(value) { return value ? new Date(value).toLocaleTimeString("es-PE", { hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "-"; }
function modernIcon(name) {
  const paths = {
    courses: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>`,
    exams: `<path d="M9 5h10a2 2 0 0 1 2 2v12H9a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M7 7H5a2 2 0 0 0-2 2v10h14M12 9h5M12 13h5"/>`,
    results: `<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>`,
    course: `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>`
    ,lesson: `<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h6"/>`
    ,page: `<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/>`
    ,video: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>`
    ,pdf: `<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h4"/>`
    ,download: `<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/>`
    ,task: `<path d="M7 4h10v17H7z"/><path d="M9 4V2h6v2M10 9h4M10 13h4M10 17h3"/>`
    ,quiz: `<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.2 2.1c-.8.4-1 1-1 1.9M12 17h.01"/>`
    ,link: `<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>`
    ,progress: `<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>`
    ,certificate: `<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1 8 4.5-2 4.5 2-1-8M9.5 9l1.5 1.5L14.5 7"/>`
    ,students: `<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5M17 14a5 5 0 0 1 4 5"/>`
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
  document.body.classList.toggle("lesson-mode", id === "lesson-view");
  document.body.classList.toggle("exam-in-progress", id === "exam-view");
  document.body.classList.remove("student-game-mode");
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
  sb.auth.onAuthStateChange(async (event, session) => {
    if (!appReady) return;
    if (authTransitionPending && event === "SIGNED_IN") return;
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
  const coursesById = new Map(catalogCourses.map(course => [course.id, course]));
  dynamicCourses.forEach(course => coursesById.set(course.id, course));
  publishedCourses = [...coursesById.values()].filter(course => !changes.get(course.id)?.deleted).map(course => {
    const change = changes.get(course.id);
    const compatibleModules = legacyCourseModules.get(course.id);
    const changedModules = change?.modules === null || change?.modules === undefined ? compatibleModules : normalizeModules(change.modules);
    return change || compatibleModules ? { ...course, name: change?.name || course.name, description: change?.description ?? course.description, modules: changedModules ?? course.modules } : course;
  });
  const visibleCourseIds = new Set(publishedCourses.map(course => course.id));
  const examsById = new Map(catalogExams.map(exam => [exam.id, exam]));
  dynamicExams.forEach(exam => examsById.set(exam.id, exam));
  publishedExams = [...examsById.values()].filter(exam => visibleCourseIds.has(exam.courseId));
}
function menuIcon(name) {
  const paths = {
    sound: `<path d="M11 5 6.5 8.5H3v7h3.5L11 19z"/><path d="M15 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/>`,
    muted: `<path d="M11 5 6.5 8.5H3v7h3.5L11 19z"/><path d="m16 10 5 5m0-5-5 5"/>`,
    profile: `<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>`,
    logout: `<path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/>`
  };
  return `<svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

async function loadCourseChanges() {
  if (!sb || !currentUser) return;
  await loadDynamicCourses();
  let { data, error } = await sb.from("course_changes").select("course_id, name, description, modules, deleted, updated_at");
  if (error?.code === "42703") ({ data, error } = await sb.from("course_changes").select("course_id, name, description, deleted, updated_at"));
  if (error) {
    console.error("No se pudieron cargar los cambios de cursos:", error);
    courseChanges = [];
    legacyCourseModules = new Map();
  } else {
    const rows = data || [];
    legacyCourseModules = decodeLegacyModuleRows(rows, [...catalogCourses, ...dynamicCourses]);
    courseChanges = rows.filter(row => !isLegacyModuleRow(row));
  }
  applyCourseChanges();
}
async function loadDynamicCourses() {
  let courseQuery = await sb.from("academy_courses").select("course_id, name, description, teacher_name, modules, updated_at").eq("published", true);
  if (courseQuery.error?.code === "42703") courseQuery = await sb.from("academy_courses").select("course_id, name, description, teacher_name, updated_at").eq("published", true);
  const [courseResponse, examResponse, questionResponse] = await Promise.all([
    Promise.resolve(courseQuery),
    sb.from("academy_exams").select("exam_id, course_id, title, minutes, questions_to_show, attempts_allowed, option_count").eq("published", true),
    sb.from("academy_questions").select("exam_id, question_id, position, text, image, options, correct").eq("published", true).order("position", { ascending: true })
  ]);
  const error = courseResponse.error || examResponse.error || questionResponse.error;
  if (error) {
    if (String(error.code) !== "42P01") console.error("No se pudieron cargar los cursos normalizados desde Supabase:", error);
    dynamicCourses = [];
    dynamicExams = [];
    return;
  }
  dynamicCourses = (courseResponse.data || []).map(row => ({ id: row.course_id, name: row.name, description: row.description || "", teacherName: row.teacher_name || "Profesor", modules: normalizeModules(row.modules), updatedAt: row.updated_at, dynamic: true }));
  const questionsByExam = new Map();
  (questionResponse.data || []).forEach(row => {
    if (!questionsByExam.has(row.exam_id)) questionsByExam.set(row.exam_id, []);
    questionsByExam.get(row.exam_id).push({ id: row.question_id, text: row.text, image: row.image || "", options: row.options, correct: row.correct });
  });
  dynamicExams = (examResponse.data || []).map(row => normalizeExam({
    id: row.exam_id, course_id: row.course_id, title: row.title, minutes: row.minutes,
    questions_to_show: row.questions_to_show, attempts_allowed: row.attempts_allowed,
    option_count: row.option_count, published: true, questions: questionsByExam.get(row.exam_id) || []
  }, `Supabase: ${row.title}`, row.course_id));
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
      modules: normalizeModules(course.modules),
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
  document.body.classList.remove("auth-galactic-burst");
  const isTeacher = currentUser?.role === "teacher";
  document.body.classList.toggle("teacher-shell-mode", isTeacher);
  if (!currentUser) {
    $("#auth-view .auth-layout")?.classList.remove("auth-login-exit");
    $("#session-area").innerHTML = "";
    show("auth-view");
    return;
  }
  const activeTeacherTab = $("#teacher-view .tab-content.active")?.id || "teacher-home";
  const teacherNavigation = isTeacher ? `<nav class="shell-teacher-nav" aria-label="Secciones del profesor">
    <div class="shell-nav-label"><strong>Espacio docente</strong><small>Gestión académica</small></div>
    <button class="shell-nav-item ${activeTeacherTab === "teacher-home" ? "active" : ""}" data-teacher-tab="teacher-home" type="button"><span aria-hidden="true">⌂</span>Inicio</button>
    <button class="shell-nav-item ${activeTeacherTab === "teacher-courses" ? "active" : ""}" data-teacher-tab="teacher-courses" type="button"><span aria-hidden="true">▣</span>Cursos <b id="courses-tab-count">0</b></button>
    <button class="shell-nav-item ${activeTeacherTab === "teacher-exams" ? "active" : ""}" data-teacher-tab="teacher-exams" type="button"><span aria-hidden="true">✎</span>Evaluaciones <b id="exams-tab-count">0</b></button>
    <button class="shell-nav-item ${activeTeacherTab === "teacher-grades" ? "active" : ""}" data-teacher-tab="teacher-grades" type="button"><span aria-hidden="true">✓</span>Calificaciones <b id="grades-tab-count">0</b></button>
  </nav>` : "";
  const soundControl = isTeacher ? "" : `<button id="sound-btn" class="btn ghost sound-btn" aria-pressed="${soundEnabled}" title="${soundEnabled ? "Silenciar sonidos" : "Activar sonidos"}">${menuIcon(soundEnabled ? "sound" : "muted")}<span>${soundEnabled ? "Sonido activado" : "Sonido silenciado"}</span></button>`;
  $("#session-area").innerHTML = `${teacherNavigation}<div class="user-menu"><span class="user-avatar">${esc(currentUser.name.charAt(0).toUpperCase())}</span><span class="user-identity"><strong>${esc(currentUser.name)}</strong><small>${isTeacher ? "Profesor" : "Alumno"}</small><small class="user-email">${esc(currentUser.email || "")}</small></span><div class="user-actions">${soundControl}<button id="profile-btn" class="btn ghost">${menuIcon("profile")}<span>Mi perfil</span></button><button id="logout-btn" class="btn ghost logout-btn">${menuIcon("logout")}<span>Cerrar sesión</span></button></div></div>`;
  $("#sound-btn")?.addEventListener("click", toggleSound);
  $("#profile-btn").addEventListener("click", openProfile);
  $("#logout-btn").addEventListener("click", logout);
  $$("#session-area [data-teacher-tab]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.teacherTab === "teacher-exams" || button.dataset.teacherTab === "teacher-courses") {
      activeTeacherCourseId = null;
      activeTeacherCourseSection = "overview";
      renderTeacherExamWorkspace(getTeacherCourses(), getTeacherExams());
    }
    switchTab("teacher", button.dataset.teacherTab, button);
  }));
  if (isTeacher) renderTeacher(); else renderStudent();
}

function bindStaticEvents() {
  $("#sidebar-toggle").addEventListener("click", toggleSidebar);
  $("#brand-link").addEventListener("click", event => {
    event.preventDefault();
    if (activeExam && timerInterval) { alert("No puedes salir mientras el examen está activo. Entrégalo para continuar."); return; }
    if (currentUser) renderApp();
  });
  $$(".auth-tab").forEach(button => button.addEventListener("click", () => {
    const authLayout = $("#auth-view .auth-layout");
    const isRegister = button.dataset.auth === "register";
    $$(".auth-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    authLayout.dataset.authMode = isRegister ? "register" : "login";
    authLayout.classList.toggle("register-active", isRegister);
    $("#login-form").classList.toggle("hidden", isRegister);
    $("#register-form").classList.toggle("hidden", !isRegister);
  }));
  bindPasswordToggles();
  $("#register-form").addEventListener("submit", registerUser);
  $("#login-form").addEventListener("submit", loginUser);
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#new-course-btn").addEventListener("click", () => openCourseModal());
  $("#teacher-head-new-course").addEventListener("click", () => openCourseModal());
  $("#teacher-head-new-exam").addEventListener("click", () => openExamModal());
  $("#course-search").addEventListener("input", renderTeacherCourseList);
  $("#new-exam-btn").addEventListener("click", () => openExamModal());
  $("#course-form").addEventListener("submit", saveCourseDraft);
  $("#course-name").addEventListener("input", updateCourseSetupPreview);
  $("#course-description").addEventListener("input", updateCourseSetupPreview);
  $("#module-form").addEventListener("submit", saveModule);
  $("#activity-form").addEventListener("submit", saveActivity);
  $("#module-unlock-rule").addEventListener("change", toggleModuleUnlockDetail);
  $("#lesson-return").addEventListener("click", () => { activeLessonCourseId = null; activeLessonActivityId = null; renderStudent(); });
  $("#lesson-menu-toggle").addEventListener("click", toggleLessonSidebar);
  $("#lesson-sidebar-close").addEventListener("click", closeLessonSidebar);
  $("#lesson-complete").addEventListener("click", completeActiveLesson);
  $("#lesson-previous").addEventListener("click", () => navigateLesson(-1));
  $("#lesson-next").addEventListener("click", () => navigateLesson(1));
  $$(".lesson-tab").forEach(button => button.addEventListener("click", () => { activeLessonTab = button.dataset.lessonTab; renderLessonTabs(); }));
  $("#publish-course-form").addEventListener("submit", publishSelectedCourseExams);
  $("#exam-editor-form").addEventListener("submit", saveExamDraft);
  $("#editor-option-count").addEventListener("change", changeOptionCount);
  $("#add-question-btn").addEventListener("click", addBuilderQuestion);
  $("#generate-questions-btn").addEventListener("click", generateQuestions);
  $("#import-questions").addEventListener("change", importQuestions);
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
  $$('[data-close]').forEach(button => button.addEventListener("click", () => closeModal(button.dataset.close)));
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
    button.innerHTML = `<svg class="password-eye eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/><path class="eye-slash" d="m4 4 16 16"/></svg><svg class="password-eye eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>`;
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
  authTransitionPending = true;
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("#login-email").value.trim().toLowerCase(),
      password: $("#login-password").value
    });
    if (error) throw error;
    $("#login-error").textContent = "";
    await setSessionFromSupabase(data.session, false);
    if (!currentUser) throw new Error("No se pudo cargar el perfil de esta cuenta.");
    const exitAnimation = playAuthLoginExit();
    await syncPendingResults(false);
    await refreshResults();
    recoverInterruptedAttempt();
    await exitAnimation;
    renderApp();
  } catch (error) {
    console.error("Login:", error);
    document.body.classList.remove("auth-galactic-burst");
    $("#auth-view .auth-layout")?.classList.remove("auth-login-exit");
    $("#login-error").textContent = translateError(error);
  } finally {
    authTransitionPending = false;
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
  activeTeacherCourseId = null;
  activeStudentCourseId = null;
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
  const courses = getTeacherCourses();
  const exams = getTeacherExams();
  const moduleCount = courses.reduce((total, course) => total + normalizeModules(course.modules).length, 0);
  const studentCount = new Set(results.map(result => result.studentId)).size;
  $("#teacher-stats").innerHTML =
    stat("Cursos totales", courses.length, "courses", "published") +
    stat("Módulos creados", moduleCount, "progress", "published") +
    stat("Evaluaciones", exams.length, "exams", "published") +
    stat("Estudiantes activos", studentCount, "students", "grades");
  $("#courses-tab-count").textContent = publishedCourses.length + drafts.courses.length;
  $("#exams-tab-count").textContent = exams.length;
  $("#grades-tab-count").textContent = results.length;
  renderTeacherOverview();
  renderTeacherCourseList(false);
  renderTeacherExamWorkspace(courses, exams);
  fillTeacherFilters();
  renderTeacherGrades(filteredTeacherResults());
  bindTeacherActions();
  bindTeacherExamWorkspaceActions();
  $$(".stat-card").forEach(card => card.addEventListener("click", () => activateStat(card.dataset.statAction)));
}
function getTeacherCourses() {
  return [...new Map([...publishedCourses, ...drafts.courses].map(course => [course.id, course])).values()];
}
function getTeacherExams() {
  return [...publishedExams, ...drafts.exams];
}
function renderTeacherOverview() {
  const allCourses = [...publishedCourses, ...drafts.courses];
  const allExams = [...publishedExams, ...drafts.exams];
  const recentCourses = allCourses.slice(0, 6);
  const courseCards = recentCourses.length ? recentCourses.map(course => {
    const examCount = allExams.filter(exam => exam.courseId === course.id).length;
    const isDraft = drafts.courses.some(item => item.id === course.id);
    const modules = normalizeModules(course.modules);
    const activities = modules.reduce((total, module) => total + module.activities.length, 0);
    return `<article class="teacher-home-course-card"><div class="dashboard-course-cover"><span>${esc(course.name.charAt(0).toLocaleUpperCase("es"))}</span><small>${isDraft ? "BORRADOR" : "PUBLICADO"}</small></div><div class="dashboard-course-card-body"><span class="eyebrow">CURSO</span><h4>${esc(course.name)}</h4><p>${esc(course.description || "Curso listo para organizar contenido.")}</p><div class="dashboard-course-metrics"><span><b>${modules.length}</b> módulos</span><span><b>${activities}</b> recursos</span><span><b>${examCount}</b> evaluaciones</span></div><button class="btn primary manage-course-content" data-course-id="${esc(course.id)}" type="button">Abrir curso <span aria-hidden="true">→</span></button></div></article>`;
  }).join("") : `<div class="overview-empty"><strong>Tu espacio está listo</strong><p>Crea el primer curso y después organiza sus módulos y contenidos.</p><button class="btn primary overview-new-course-dynamic" type="button">Crear primer curso</button></div>`;
  const todoItems = [
    ...drafts.courses.map(course => ({ label:"Publicar curso", title:course.name, action:"courses" })),
    ...drafts.exams.map(exam => ({ label:"Publicar evaluación", title:exam.title, action:"exams" })),
    ...publishedCourses.filter(course => !normalizeModules(course.modules).length).map(course => ({ label:"Agregar módulos", title:course.name, action:"courses" }))
  ].slice(0, 5);
  const recentResults = results.slice(0, 4);
  $("#teacher-overview").innerHTML = `<section class="dashboard-course-library teacher-course-library"><div class="dashboard-library-head"><div><span class="eyebrow">MIS CURSOS</span><h3>Continúa construyendo tu aula</h3><p>Abre un curso para crear módulos y organizar páginas, archivos, videos y evaluaciones.</p></div><div><button class="btn secondary overview-link" data-overview-tab="teacher-courses" type="button">Ver todos</button><button class="btn primary overview-new-course-dynamic" type="button">+ Crear curso</button></div></div><div class="dashboard-course-gallery">${courseCards}</div></section>
    <div class="teacher-dashboard-secondary"><aside class="lms-dashboard-side">
      <section class="overview-panel lms-todo-panel"><div class="overview-panel-head"><div><span class="eyebrow">POR HACER</span><h3>Pendientes</h3></div></div><div class="lms-todo-list">${todoItems.length ? todoItems.map(item => `<button data-overview-tab="teacher-${item.action}" type="button"><span></span><span><small>${esc(item.label)}</small><strong>${esc(item.title)}</strong></span><b>›</b></button>`).join("") : `<p class="lms-empty-note">No tienes tareas pendientes.</p>`}</div></section>
      <section class="overview-panel lms-activity-panel"><div class="overview-panel-head"><div><span class="eyebrow">ACTIVIDAD</span><h3>Intentos recientes</h3></div><button class="overview-link" data-overview-tab="teacher-grades" type="button">Ver libro</button></div><div>${recentResults.length ? recentResults.map(result => `<article><span>${esc((result.studentName || "A").charAt(0).toUpperCase())}</span><div><strong>${esc(result.studentName || "Alumno")}</strong><small>${esc(result.examTitle)} · ${result.score}/20</small></div></article>`).join("") : `<p class="lms-empty-note">Aún no hay intentos registrados.</p>`}</div></section>
    </aside></div>`;
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
  const matches = (course, state) => !query || `${course.name} ${state}`.toLocaleLowerCase("es").includes(query);
  const published = publishedCourses.map(course => {
    if (!matches(course, "publicado")) return "";
    return `<article class="course-directory-row"><span class="course-row-accent" aria-hidden="true"></span><button class="course-row-main manage-course-content" data-course-id="${esc(course.id)}" type="button"><span class="course-row-icon" aria-hidden="true">${modernIcon("course")}</span><span class="course-row-copy"><strong>${esc(course.name)}</strong><small class="course-row-status published"><i></i>Publicado</small></span></button><button class="course-row-open manage-course-content" data-course-id="${esc(course.id)}" type="button">Abrir <span aria-hidden="true">→</span></button><details class="course-row-menu"><summary aria-label="Más acciones para ${esc(course.name)}" title="Más acciones">•••</summary><div><button class="create-exam-course" data-id="${esc(course.id)}" type="button">Crear evaluación</button><button class="edit-published-course" data-id="${esc(course.id)}" type="button">Editar curso</button><button class="delete-published-course danger" data-id="${esc(course.id)}" type="button">Eliminar curso</button></div></details></article>`;
  }).filter(Boolean);
  const local = drafts.courses.map(course => {
    if (!matches(course, "borrador")) return "";
    return `<article class="course-directory-row draft"><span class="course-row-accent" aria-hidden="true"></span><button class="course-row-main manage-course-content" data-course-id="${esc(course.id)}" type="button"><span class="course-row-icon" aria-hidden="true">${modernIcon("course")}</span><span class="course-row-copy"><strong>${esc(course.name)}</strong><small class="course-row-status draft"><i></i>Borrador</small></span></button><button class="course-row-open manage-course-content" data-course-id="${esc(course.id)}" type="button">Abrir <span aria-hidden="true">→</span></button><details class="course-row-menu"><summary aria-label="Más acciones para ${esc(course.name)}" title="Más acciones">•••</summary><div><button class="publish-course" data-id="${esc(course.id)}" type="button">Publicar curso</button><button class="create-exam-course" data-id="${esc(course.id)}" type="button">Crear evaluación</button><button class="edit-course" data-id="${esc(course.id)}" type="button">Editar curso</button><button class="delete-course danger" data-id="${esc(course.id)}" type="button">Eliminar curso</button></div></details></article>`;
  }).filter(Boolean);
  return published.concat(local).join("") || `<div class="course-directory-empty">${modernIcon("course")}<strong>No se encontraron cursos</strong><small>Prueba con otro nombre o crea un curso nuevo.</small></div>`;
}
function renderTeacherExamWorkspace(courses, exams) {
  const coursesById = new Map(courses.map(course => [course.id, course]));
  exams.forEach(exam => {
    if (!coursesById.has(exam.courseId)) coursesById.set(exam.courseId, { id: exam.courseId, name: "Curso no encontrado", description: "Revisa la asignación de estas evaluaciones." });
  });
  const directory = $("#teacher-exam-directory");
  const courseDirectory = $("#teacher-course-directory");
  const workspace = $("#teacher-course-workspace");
  const activeCourse = coursesById.get(activeTeacherCourseId);
  if (!activeCourse) {
    activeTeacherCourseId = null;
    directory.classList.remove("hidden");
    courseDirectory.classList.remove("hidden");
    workspace.classList.add("hidden");
    $("#teacher-exam-course-list").innerHTML = coursesById.size
      ? [...coursesById.values()].map(course => renderTeacherExamCourseLink(course, exams)).join("")
      : emptyCard("Todavía no hay cursos. Crea uno para agregar evaluaciones.");
    return;
  }
  directory.classList.add("hidden");
  courseDirectory.classList.add("hidden");
  workspace.classList.remove("hidden");
  workspace.innerHTML = renderTeacherCourseWorkspace(activeCourse, exams.filter(exam => exam.courseId === activeCourse.id));
}
function renderTeacherExamCourseLink(course, exams) {
  const courseExams = exams.filter(exam => exam.courseId === course.id);
  const questionCount = courseExams.reduce((total, exam) => total + exam.questions.length, 0);
  const isDraftCourse = drafts.courses.some(item => item.id === course.id);
  return `<button class="exam-course-link open-course-workspace" data-course-id="${esc(course.id)}" type="button">
    <span class="exam-course-link-icon">${modernIcon("course")}</span>
    <span class="exam-course-link-copy"><small>CURSO</small><strong>${esc(course.name)}</strong><span>${esc(course.description || "Sin descripción registrada")}</span></span>
    <span class="exam-course-link-stats"><span><strong>${courseExams.length}</strong> ${courseExams.length === 1 ? "examen" : "exámenes"}</span><span><strong>${questionCount}</strong> preguntas en bancos</span></span>
    <span class="status ${isDraftCourse ? "draft" : "published"}">${isDraftCourse ? "Curso local" : "Publicado"}</span>
    <span class="exam-course-link-arrow" aria-hidden="true">→</span>
  </button>`;
}
function renderTeacherCourseWorkspace(course, exams) {
  const isDraftCourse = drafts.courses.some(item => item.id === course.id);
  const publishedCount = exams.filter(exam => publishedExams.some(item => item.id === exam.id)).length;
  const questionCount = exams.reduce((total, exam) => total + exam.questions.length, 0);
  const sections = [
    ["overview", "Resumen"],
    ["modules", `Módulos (${(course.modules || []).length})`],
    ["exams", `Exámenes (${exams.length})`],
    ["questions", `Banco de preguntas (${questionCount})`]
  ];
  let content = "";
  if (activeTeacherCourseSection === "modules") content = renderTeacherCourseModules(course);
  else if (activeTeacherCourseSection === "exams") content = renderTeacherCourseExams(course, exams);
  else if (activeTeacherCourseSection === "questions") content = renderTeacherCourseQuestions(exams);
  else content = renderTeacherCourseOverview(course, exams, publishedCount, questionCount);
  return `<div class="course-workspace-page">
    <button class="course-workspace-back" id="back-to-exam-courses" type="button">← ${activeTeacherWorkspaceOrigin === "courses" ? "Mis cursos" : "Todos los cursos"}</button>
    <header class="course-workspace-hero">
      <span class="course-workspace-icon">${modernIcon("course")}</span>
      <div><span class="eyebrow">ESPACIO DEL CURSO</span><h3>${esc(course.name)}</h3><p>${esc(course.description || "Sin descripción registrada")}</p></div>
      <span class="status ${isDraftCourse ? "draft" : "published"}">${isDraftCourse ? "Curso local" : "Publicado"}</span>
      <button class="btn primary add-course-module" data-course-id="${esc(course.id)}" type="button">+ Crear módulo</button>
    </header>
    <nav class="course-workspace-nav" aria-label="Secciones de ${esc(course.name)}">${sections.map(([id, label]) => `<button class="course-subpage ${activeTeacherCourseSection === id ? "active" : ""}" data-course-section="${id}" type="button">${label}</button>`).join("")}</nav>
    <section class="course-workspace-content">${content}</section>
  </div>`;
}
function activityTypeLabel(type) {
  return ({ page:"Página", lesson:"Lección", video:"Video", pdf:"Archivo PDF", download:"Descargable", task:"Tarea", quiz:"Evaluación", link:"Enlace" })[type] || "Lección";
}
function unlockRuleLabel(module, index) {
  const detail = module.unlockDetail ? `: ${esc(module.unlockDetail)}` : "";
  return ({ immediate:"Disponible inmediatamente", previous:index ? "Tras completar el módulo anterior" : "Disponible inmediatamente", evaluation:`Después de aprobar una evaluación${detail}`, date:`Disponible desde${detail}` })[module.unlockRule] || "Disponible inmediatamente";
}
function renderTeacherCourseModules(course) {
  const modules = normalizeModules(course.modules);
  return `<div class="course-subpage-head"><div><span class="eyebrow">CONTENIDO DEL CURSO</span><h4>Módulos del curso</h4><p>Cada módulo reúne el material que verá el alumno en el orden definido.</p></div><button class="btn primary add-course-module" data-course-id="${esc(course.id)}" type="button">+ Crear módulo</button></div><div class="module-content-types" aria-label="Contenido disponible"><span>Dentro de cada módulo puedes añadir:</span><b>${modernIcon("page")} Página</b><b>${modernIcon("pdf")} Archivo PDF</b><b>${modernIcon("video")} Video</b><b>${modernIcon("link")} Enlace</b><b>${modernIcon("task")} Tarea</b><b>${modernIcon("quiz")} Evaluación</b></div><p class="drag-help">Arrastra los controles ⋮⋮ para cambiar el orden. También puedes usar las flechas.</p>
    <div class="teacher-module-list">${modules.length ? modules.map((module, index) => `<article class="teacher-module-card" data-course-id="${esc(course.id)}" data-module-drop="${esc(module.id)}">
      <header><span class="drag-handle module-drag-handle" draggable="true" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" role="button" tabindex="0" aria-label="Arrastrar módulo ${esc(module.title)}">⋮⋮</span><span class="module-order">${index + 1}</span><div><h4>${esc(module.title)}</h4><small>${unlockRuleLabel(module, index)} · ${quantity(module.activities.length, "actividad", "actividades")}</small></div><div class="module-actions"><button class="icon-btn move-module" data-direction="up" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" ${index === 0 ? "disabled" : ""} aria-label="Subir módulo">↑</button><button class="icon-btn move-module" data-direction="down" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" ${index === modules.length - 1 ? "disabled" : ""} aria-label="Bajar módulo">↓</button><button class="icon-btn edit-module" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}">Editar</button><button class="icon-btn delete delete-module" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}">Eliminar</button></div></header>
      <div class="teacher-activity-list">${module.activities.length ? module.activities.map((activity, activityIndex) => `<div class="teacher-activity-row" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" data-activity-drop="${esc(activity.id)}"><span class="drag-handle activity-drag-handle" draggable="true" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" data-activity-id="${esc(activity.id)}" role="button" tabindex="0" aria-label="Arrastrar actividad ${esc(activity.title)}">⋮</span><span class="activity-type-icon">${modernIcon(activity.type)}</span><div><strong>${esc(activity.title)}</strong><small>${activityTypeLabel(activity.type)}${activity.description ? ` · ${esc(activity.description)}` : activity.url ? ` · ${esc(activity.url)}` : ""}</small></div><div class="activity-actions"><button class="icon-btn move-activity" data-direction="up" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" data-activity-id="${esc(activity.id)}" ${activityIndex === 0 ? "disabled" : ""} aria-label="Subir actividad">↑</button><button class="icon-btn move-activity" data-direction="down" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" data-activity-id="${esc(activity.id)}" ${activityIndex === module.activities.length - 1 ? "disabled" : ""} aria-label="Bajar actividad">↓</button><button class="icon-btn edit-activity" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" data-activity-id="${esc(activity.id)}">Editar</button><button class="icon-btn delete delete-activity" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" data-activity-id="${esc(activity.id)}">Eliminar</button></div></div>`).join("") : `<p class="module-empty">Este módulo aún no tiene actividades.</p>`}</div>
      <button class="btn secondary add-module-activity" data-course-id="${esc(course.id)}" data-module-id="${esc(module.id)}" type="button">+ Agregar actividad</button>
    </article>`).join("") : `<div class="course-workspace-empty module-empty-state"><span>${modernIcon("courses")}</span><strong>Aún no hay módulos</strong><p>Crea el primero para comenzar a organizar páginas, archivos y actividades.</p><button class="btn primary add-course-module" data-course-id="${esc(course.id)}" type="button">+ Crear primer módulo</button></div>`}</div>`;
}
function renderTeacherCourseOverview(course, exams, publishedCount, questionCount) {
  const recent = exams.slice(0, 3);
  return `<div class="course-overview-grid">
    <section class="course-overview-main"><span class="eyebrow">RESUMEN</span><h4>Contenido de ${esc(course.name)}</h4><p>Desde este espacio puedes administrar las evaluaciones y sus bancos de preguntas sin mezclar contenido de otros cursos.</p>${recent.length ? `<div class="course-recent-list">${recent.map(exam => `<button class="course-recent-exam edit-exam" data-id="${esc(exam.id)}" type="button"><span>${modernIcon("exams")}</span><span><strong>${esc(exam.title)}</strong><small>${exam.minutes} min · ${quantity(exam.questions.length, "pregunta")}</small></span><b>Editar →</b></button>`).join("")}</div>` : `<div class="course-workspace-empty"><strong>Aún no hay evaluaciones</strong><p>Crea la primera evaluación de este curso.</p></div>`}</section>
    <aside class="course-overview-stats"><div><span>Evaluaciones</span><strong>${exams.length}</strong></div><div><span>Publicadas</span><strong>${publishedCount}</strong></div><div><span>Preguntas en bancos</span><strong>${questionCount}</strong></div></aside>
  </div>`;
}
function renderTeacherCourseExams(course, exams) {
  return `<div class="course-subpage-head"><div><span class="eyebrow">EVALUACIONES</span><h4>Exámenes del curso</h4><p>Solo se muestra el contenido perteneciente a ${esc(course.name)}.</p></div><button class="btn primary create-exam-course" data-id="${esc(course.id)}" type="button">+ Crear examen</button></div>
    <div class="course-exam-list">${exams.length ? exams.map(renderTeacherExamRow).join("") : `<div class="course-workspace-empty"><strong>Este curso todavía no tiene exámenes</strong><p>Usa “Crear examen” para agregar el primero.</p></div>`}</div>`;
}
function renderTeacherCourseQuestions(exams) {
  const questionCount = exams.reduce((total, exam) => total + exam.questions.length, 0);
  return `<div class="course-subpage-head"><div><span class="eyebrow">BANCO DE PREGUNTAS</span><h4>${quantity(questionCount, "pregunta")}</h4><p>Las preguntas están organizadas por el examen al que pertenecen.</p></div></div>
    <div class="course-question-banks">${exams.length ? exams.map(exam => `<article class="course-question-bank"><span>${modernIcon("exams")}</span><div><strong>${esc(exam.title)}</strong><small>${quantity(exam.questions.length, "pregunta")} · ${exam.optionCount} opciones por pregunta</small></div><button class="btn secondary edit-exam" data-id="${esc(exam.id)}" type="button">Abrir banco</button></article>`).join("") : `<div class="course-workspace-empty"><strong>No hay bancos de preguntas</strong><p>Los bancos aparecerán cuando crees una evaluación.</p></div>`}</div>`;
}
function renderTeacherExamRow(exam) {
  const isDraft = !publishedExams.some(item => item.id === exam.id);
  const actions = isDraft
    ? `<button class="btn secondary edit-exam" data-id="${esc(exam.id)}" type="button">Editar</button><button class="btn secondary export-draft" data-id="${esc(exam.id)}" type="button">Exportar JSON</button><button class="icon-btn delete delete-exam" data-id="${esc(exam.id)}" type="button">Eliminar</button>`
    : `<button class="btn secondary edit-exam" data-id="${esc(exam.id)}" type="button">Modificar</button>`;
  return `<article class="exam-module-item ${isDraft ? "is-draft" : ""}">
    <span class="exam-module-type-icon">${modernIcon("exams")}</span>
    <div class="exam-module-item-main">
      <div class="exam-module-title-line"><h4>${esc(exam.title)}</h4><span class="status ${isDraft ? "draft" : "published"}">${isDraft ? "Borrador local" : "Publicado"}</span></div>
      <div class="exam-module-meta"><span><strong>${exam.questionsToShow}</strong> preguntas</span><span><strong>${exam.minutes}</strong> min</span><span><strong>${exam.attemptsAllowed}</strong> ${exam.attemptsAllowed === 1 ? "intento" : "intentos"}</span><span>Banco: <strong>${quantity(exam.questions.length, "pregunta")}</strong></span><span><strong>${exam.optionCount}</strong> opciones</span></div>
    </div>
    <div class="exam-module-actions">${actions}</div>
  </article>`;
}
function bindTeacherActions() {
  $$("[data-overview-tab]").forEach(button => button.addEventListener("click", () => switchTab("teacher", button.dataset.overviewTab, $(`[data-teacher-tab="${button.dataset.overviewTab}"]`))));
  $$(".overview-new-course-dynamic").forEach(button => button.addEventListener("click", () => openCourseModal()));
  $$(".overview-new-exam-dynamic").forEach(button => button.addEventListener("click", () => openExamModal()));
  $$(".view-course").forEach(button => button.addEventListener("click", () => switchTab("teacher", "teacher-exams", $('[data-teacher-tab="teacher-exams"]'))));
  $$(".create-exam-course").filter(button => !button.closest("#teacher-course-workspace")).forEach(button => button.addEventListener("click", () => openExamModal(null, button.dataset.id)));
  $$(".edit-course").forEach(button => button.addEventListener("click", () => openCourseModal(button.dataset.id)));
  $$(".delete-course").forEach(button => button.addEventListener("click", () => deleteCourseDraft(button.dataset.id)));
  $$(".edit-published-course").forEach(button => button.addEventListener("click", () => openCourseModal(button.dataset.id)));
  $$(".delete-published-course").forEach(button => button.addEventListener("click", () => deletePublishedCourse(button.dataset.id)));
  $$(".edit-exam").filter(button => !button.closest("#teacher-course-workspace")).forEach(button => button.addEventListener("click", () => openExamModal(button.dataset.id)));
  $$(".delete-exam").filter(button => !button.closest("#teacher-course-workspace")).forEach(button => button.addEventListener("click", () => deleteExamDraft(button.dataset.id)));
  $$(".export-draft").filter(button => !button.closest("#teacher-course-workspace")).forEach(button => button.addEventListener("click", () => { openExamModal(button.dataset.id); setTimeout(exportCurrentExam, 50); }));
  $$(".export-course").forEach(button => button.addEventListener("click", () => exportCourseDraft(button.dataset.id)));
  $$(".publish-course").forEach(button => button.addEventListener("click", () => openPublishCourseModal(button.dataset.id)));
  $$(".manage-course-content").forEach(button => button.addEventListener("click", () => openTeacherCourseWorkspace(button.dataset.courseId, "modules", "courses")));
}
function openTeacherCourseWorkspace(courseId, section = "overview", origin = "exams") {
  activeTeacherCourseId = courseId;
  activeTeacherCourseSection = section;
  activeTeacherWorkspaceOrigin = origin;
  switchTab("teacher", "teacher-courses", $('[data-teacher-tab="teacher-courses"]'));
  renderTeacherExamWorkspace(getTeacherCourses(), getTeacherExams());
  bindTeacherExamWorkspaceActions();
}
function exportCourseDraft(id) {
  const course = drafts.courses.find(item => item.id === id);
  if (!course) return;
  download(JSON.stringify({ schema_version: 2, id: course.id, name: course.name, description: course.description || "", teacher_name: course.teacherName || currentUser.name, modules: normalizeModules(course.modules) }, null, 2), `${slug(course.id)}.json`, "application/json;charset=utf-8");
}
function openPublishCourseModal(id) {
  const course = drafts.courses.find(item => item.id === id);
  const exams = drafts.exams.filter(exam => exam.courseId === id);
  if (!course) return;
  if (!exams.length && !normalizeModules(course.modules).length) {
    const status = $("#course-publish-status");
    status.className = "course-publish-status error";
    status.textContent = "Agrega al menos un módulo o una evaluación antes de publicar el curso.";
    return;
  }
  publishingCourseId = id;
  $("#publish-course-title").textContent = `Publicar ${course.name}`;
  $("#publish-exam-options").innerHTML = exams.length ? exams.map(exam => `<label class="publish-exam-option"><input type="checkbox" name="publish-exam" value="${esc(exam.id)}" checked><span><strong>${esc(exam.title)}</strong><small>${quantity(exam.questions.length, "pregunta")} · ${exam.minutes} min</small></span></label>`).join("") : `<p class="muted">Se publicarán los módulos y actividades del curso. Aún no hay evaluaciones.</p>`;
  $("#publish-course-error").textContent = "";
  $("#publish-course-modal").classList.remove("hidden");
}
function bindTeacherExamWorkspaceActions() {
  $$(".open-course-workspace").forEach(button => button.addEventListener("click", () => {
    openTeacherCourseWorkspace(button.dataset.courseId, "overview", "exams");
  }));
  $("#back-to-exam-courses")?.addEventListener("click", () => {
    activeTeacherCourseId = null;
    activeTeacherCourseSection = "overview";
    if (activeTeacherWorkspaceOrigin === "courses") {
      activeTeacherWorkspaceOrigin = "exams";
      switchTab("teacher", "teacher-courses", $('[data-teacher-tab="teacher-courses"]'));
      $("#teacher-course-directory").classList.remove("hidden");
      $("#teacher-course-workspace").classList.add("hidden");
      renderTeacherCourseList();
      return;
    }
    switchTab("teacher", "teacher-exams", $('[data-teacher-tab="teacher-exams"]'));
    renderTeacherExamWorkspace(getTeacherCourses(), getTeacherExams());
    bindTeacherExamWorkspaceActions();
  });
  $$(".course-subpage").forEach(button => button.addEventListener("click", () => {
    activeTeacherCourseSection = button.dataset.courseSection;
    renderTeacherExamWorkspace(getTeacherCourses(), getTeacherExams());
    bindTeacherExamWorkspaceActions();
  }));
  $$("#teacher-course-workspace .create-exam-course").forEach(button => button.addEventListener("click", () => openExamModal(null, button.dataset.id)));
  $$("#teacher-course-workspace .edit-exam").forEach(button => button.addEventListener("click", () => openExamModal(button.dataset.id)));
  $$("#teacher-course-workspace .delete-exam").forEach(button => button.addEventListener("click", () => deleteExamDraft(button.dataset.id)));
  $$("#teacher-course-workspace .export-draft").forEach(button => button.addEventListener("click", () => { openExamModal(button.dataset.id); setTimeout(exportCurrentExam, 50); }));
  $$("#teacher-course-workspace .add-course-module").forEach(button => button.addEventListener("click", () => openModuleModal(button.dataset.courseId)));
  $$("#teacher-course-workspace .edit-module").forEach(button => button.addEventListener("click", () => openModuleModal(button.dataset.courseId, button.dataset.moduleId)));
  $$("#teacher-course-workspace .add-module-activity").forEach(button => button.addEventListener("click", () => openActivityModal(button.dataset.courseId, button.dataset.moduleId)));
  $$("#teacher-course-workspace .edit-activity").forEach(button => button.addEventListener("click", () => openActivityModal(button.dataset.courseId, button.dataset.moduleId, button.dataset.activityId)));
  $$("#teacher-course-workspace .delete-module").forEach(button => button.addEventListener("click", () => deleteModule(button.dataset.courseId, button.dataset.moduleId)));
  $$("#teacher-course-workspace .delete-activity").forEach(button => button.addEventListener("click", () => deleteActivity(button.dataset.courseId, button.dataset.moduleId, button.dataset.activityId)));
  $$("#teacher-course-workspace .move-module").forEach(button => button.addEventListener("click", () => moveModule(button.dataset.courseId, button.dataset.moduleId, button.dataset.direction)));
  $$("#teacher-course-workspace .move-activity").forEach(button => button.addEventListener("click", () => moveActivity(button.dataset.courseId, button.dataset.moduleId, button.dataset.activityId, button.dataset.direction)));
  bindModuleDragAndDrop();
}
async function publishSelectedCourseExams(event) {
  event.preventDefault();
  const courseId = publishingCourseId;
  const course = drafts.courses.find(item => item.id === courseId);
  const selectedIds = new Set($$('input[name="publish-exam"]:checked').map(input => input.value));
  const exams = drafts.exams.filter(exam => exam.courseId === courseId && selectedIds.has(exam.id));
  if (!course) return;
  if (!exams.length && !normalizeModules(course.modules).length) { $("#publish-course-error").textContent = "Agrega al menos un módulo o una evaluación antes de publicar el curso."; return; }
  const button = event.submitter;
  const status = $("#course-publish-status");
  button.disabled = true;
  $("#publish-course-error").textContent = "Publicando y verificando...";
  try {
    const payload = {
      course: { id: course.id, name: course.name, description: course.description || "", teacher_name: course.teacherName || currentUser.name, modules: normalizeModules(course.modules) },
      exams: exams.map(exam => ({ ...examToJsonSchema(exam), published: true }))
    };
    const { data, error } = await sb.rpc("publish_academy_course", { payload });
    if (error) throw error;
    if (!data || data.course_id !== course.id || Number(data.exam_count) !== exams.length) throw new Error("Supabase no confirmó todos los exámenes seleccionados.");

    await loadCourseChanges();
    const verifiedCourse = publishedCourses.find(item => item.id === course.id && item.dynamic);
    const verifiedExams = exams.filter(exam => publishedExams.some(item => item.id === exam.id && item.courseId === course.id));
    const expectedQuestions = exams.reduce((total, exam) => total + exam.questions.length, 0);
    const verifiedQuestions = verifiedExams.reduce((total, exam) => total + (publishedExams.find(item => item.id === exam.id)?.questions.length || 0), 0);
    if (!verifiedCourse || verifiedExams.length !== exams.length || verifiedQuestions !== expectedQuestions) throw new Error("La publicación no pudo recuperarse completa desde Supabase. El borrador se conservó.");

    drafts.courses = drafts.courses.filter(item => item.id !== courseId);
    drafts.exams = drafts.exams.filter(exam => !selectedIds.has(exam.id));
    saveDrafts();
    closeModal("publish-course-modal");
    publishingCourseId = null;
    renderTeacher();
    const refreshedStatus = $("#course-publish-status");
    refreshedStatus.className = "course-publish-status success";
    refreshedStatus.textContent = `${course.name} y ${quantity(exams.length, "examen")} se publicaron y verificaron correctamente.`;
  } catch (error) {
    console.error("Publicar curso:", error);
    $("#publish-course-error").textContent = error.message || translateError(error);
    status.className = "course-publish-status error";
    status.textContent = "La publicación no se completó. El borrador local permanece intacto.";
  } finally {
    button.disabled = false;
  }
}

function playAuthLoginExit() {
  const layout = $("#auth-view .auth-layout");
  if (!layout || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  layout.classList.add("auth-login-exit");
  return new Promise(resolve => {
    let burstStarted = false;
    const startBurst = () => {
      if (burstStarted) return;
      burstStarted = true;
      layout.removeEventListener("transitionend", onTransitionEnd);
      document.body.classList.add("auth-galactic-burst");
      window.setTimeout(resolve, 980);
    };
    const onTransitionEnd = event => {
      if (event.propertyName === "transform" && event.target.classList.contains("auth-card")) startBurst();
    };
    layout.addEventListener("transitionend", onTransitionEnd);
    window.setTimeout(startBurst, 860);
  });
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
        <div class="grade-date"><small>Fecha</small><strong>${formatDateOnly(grade.date)}</strong></div>
        <div class="grade-hour"><small>Hora</small><strong>${formatTimeOnly(grade.date)}</strong></div>
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
  const courses = publishedCourses.filter(course => publishedExams.some(exam => exam.courseId === course.id) || normalizeModules(course.modules).length);
  const summaries = courses.map(courseStudentSummary);
  const pendingExams = publishedExams.filter(exam => !myGrades.some(grade => grade.examId === exam.id)).length;
  $("#student-stats").innerHTML = "";
  renderStudentOverview(courses, myGrades, summaries, pendingExams);
  const activeStudentCourse = courses.find(course => course.id === activeStudentCourseId);
  if (activeStudentCourseId && !activeStudentCourse) activeStudentCourseId = null;
  $("#student-course-list").classList.toggle("hidden", Boolean(activeStudentCourse));
  $("#student-course-workspace").classList.toggle("hidden", !activeStudentCourse);
  $("#student-overview").classList.toggle("hidden", Boolean(activeStudentCourse));
  $("#student-course-list").innerHTML = renderStudentCourseDirectory(courses, summaries);
  $("#student-course-workspace").innerHTML = activeStudentCourse ? renderStudentCourseWorkspace(activeStudentCourse, myGrades) : "";
  $("#student-grades-body").innerHTML = myGrades.length ? myGrades.map(grade => {
    const exam = publishedExams.find(item => item.id === grade.examId);
    const attemptsUsed = myGrades.filter(item => item.examId === grade.examId).length;
    const canReview = grade.review?.length && attemptsUsed >= (exam?.attemptsAllowed || 1);
    return `<tr><td class="student-grade-course">${esc(grade.courseName)}</td><td class="student-grade-exam">${esc(grade.examTitle)}</td><td class="student-grade-count">${grade.attempt || 1}</td><td class="grade">${grade.score} / 20</td><td class="student-grade-count">${grade.correct} / ${grade.total}</td><td class="student-grade-date"><span>${formatDateOnly(grade.date)}</span><small>${formatTimeOnly(grade.date)}</small></td><td>${canReview ? `<button class="icon-btn review-attempt" data-id="${esc(grade.id)}">Ver respuestas</button>` : `<span class="muted small">Al agotar intentos</span>`}</td></tr>`;
  }).join("") : empty("Todavía no has rendido exámenes.", 7);
  $$(".start-exam").forEach(button => button.addEventListener("click", () => startExam(button.dataset.id)));
  $$(".review-exam").forEach(button => button.addEventListener("click", () => showExamReviews(button.dataset.id)));
  $$(".review-attempt").forEach(button => button.addEventListener("click", () => showAttemptReview(button.dataset.id)));
  $$(".student-activity-action").forEach(button => button.addEventListener("click", event => { event.stopPropagation(); toggleActivityProgress(button.dataset.courseId, button.dataset.activityId); }));
  $$(".open-lesson").forEach(button => button.addEventListener("click", () => openLesson(button.dataset.courseId, button.dataset.activityId)));
  $$(".continue-course").forEach(button => button.addEventListener("click", () => openLesson(button.dataset.courseId, button.dataset.activityId)));
  $$(".open-student-course").forEach(button => button.addEventListener("click", () => { activeStudentCourseId = button.dataset.courseId; renderStudent(); }));
  $("#back-to-student-courses")?.addEventListener("click", () => { activeStudentCourseId = null; renderStudent(); });
  $$(".student-course-grades").forEach(button => button.addEventListener("click", () => switchTab("student", "student-grades", $('[data-student-tab="student-grades"]'))));
}
function renderStudentCourseDirectory(courses, summaries) {
  if (!courses.length) return `<div class="student-library-empty">${modernIcon("course")}<strong>Todavía no tienes cursos disponibles</strong><p>Los cursos publicados por el profesor aparecerán aquí.</p></div>`;
  return `<section class="student-library-head"><div><span class="eyebrow">MIS CURSOS</span><h3>Continúa aprendiendo</h3><p>Abre un curso para consultar sus módulos, páginas, archivos y evaluaciones.</p></div><span>${quantity(courses.length, "curso disponible", "cursos disponibles")}</span></section><div class="student-course-gallery">${courses.map((course, index) => {
    const summary = summaries.find(item => item.course.id === course.id) || { total:0, completed:0, percent:0 };
    const modules = normalizeModules(course.modules);
    const examCount = publishedExams.filter(exam => exam.courseId === course.id).length;
    return `<article class="student-library-card tone-${index % 4}"><div class="student-course-cover"><span>${esc(course.name.charAt(0).toLocaleUpperCase("es"))}</span><small>${quantity(modules.length, "módulo", "módulos")}</small></div><div class="student-course-card-body"><span class="eyebrow">${esc(course.teacherName || "Profesor")}</span><h4>${esc(course.name)}</h4><p>${esc(course.description || "Contenido académico organizado por módulos.")}</p><div class="student-card-progress"><span><b>${summary.percent}%</b> completado</span><div class="course-progress-track"><i style="width:${summary.percent}%"></i></div></div><div class="student-card-footer"><small>${summary.total} actividades · ${examCount} evaluaciones</small><button class="open-student-course" data-course-id="${esc(course.id)}" type="button">Abrir curso →</button></div></div></article>`;
  }).join("")}</div>`;
}
function renderStudentCourseWorkspace(course, myGrades) {
  const modules = normalizeModules(course.modules);
  const activities = modules.reduce((total, module) => total + module.activities.length, 0);
  const exams = publishedExams.filter(exam => exam.courseId === course.id);
  return `<div class="student-course-page"><button class="course-workspace-back" id="back-to-student-courses" type="button">← Mis cursos</button><header class="student-course-hero"><div class="student-course-hero-mark">${esc(course.name.charAt(0).toLocaleUpperCase("es"))}</div><div><span class="eyebrow">ESPACIO DEL CURSO</span><h3>${esc(course.name)}</h3><p>${esc(course.description || "Contenido académico organizado por módulos.")}</p><small>Profesor: ${esc(course.teacherName || "Profesor")}</small></div><div class="student-course-hero-stats"><span><b>${modules.length}</b> módulos</span><span><b>${activities}</b> actividades</span><span><b>${exams.length}</b> evaluaciones</span></div></header><nav class="course-workspace-nav student-course-nav"><button class="course-subpage active" type="button">Curso</button><button class="course-subpage" type="button" disabled>Actividades (${activities})</button><button class="course-subpage" type="button" disabled>Evaluaciones (${exams.length})</button><button class="course-subpage student-course-grades" type="button">Calificaciones</button></nav><section class="student-course-content"><div class="student-course-content-head"><div><span class="eyebrow">CONTENIDO</span><h4>Módulos del curso</h4><p>Avanza por las páginas, archivos y actividades preparadas por tu profesor.</p></div></div>${renderStudentCourseModules(course, myGrades)}${exams.length ? `<div class="exam-rows student-course-exams"><h4>Evaluaciones del curso</h4>${exams.map(exam => renderStudentExamRow(exam, myGrades)).join("")}</div>` : ""}</section></div>`;
}
function courseStudentSummary(course) {
  const activities = normalizeModules(course.modules).flatMap(module => module.activities);
  const progress = courseProgress[course.id] || { completed:{}, lastActivityId:"" };
  const completed = activities.filter(activity => progress.completed?.[activity.id]).length;
  return { course, total:activities.length, completed, percent:activities.length ? Math.round(completed * 100 / activities.length) : 0, lastActivityId:progress.lastActivityId || "" };
}
function renderStudentOverview(courses, myGrades, summaries, pendingExams) {
  const nextCandidates = courses.flatMap(course => accessibleCourseActivities(course).filter(activity => !courseProgress[course.id]?.completed?.[activity.id]).map(activity => ({ course, activity })));
  const next = nextCandidates[0];
  const allActivities = courses.flatMap(course => normalizeModules(course.modules).flatMap(module => module.activities.map(activity => ({ course, activity }))));
  const last = allActivities.find(item => courseProgress[item.course.id]?.lastActivityId === item.activity.id);
  const pendingList = publishedExams.filter(exam => !myGrades.some(grade => grade.examId === exam.id)).slice(0, 5);
  const overall = summaries.length ? Math.round(summaries.reduce((total, summary) => total + summary.percent, 0) / summaries.length) : 0;
  $("#student-overview").innerHTML = `<div class="student-home-layout"><section class="overview-panel student-resume-panel"><div class="overview-panel-head"><div><span class="eyebrow">CONTINUAR</span><h3>Actividad actual</h3></div><span class="student-overall-progress">${overall}% general</span></div>${next ? `<div class="student-resume-body"><span class="activity-type-icon">${modernIcon(next.activity.type)}</span><div><small>${esc(next.course.name)}</small><h4>${esc(next.activity.title)}</h4><p>${activityTypeLabel(next.activity.type)} · ${esc(next.activity.moduleTitle)}</p><div class="course-progress-track"><span style="width:${overall}%"></span></div></div><button class="btn primary continue-course" data-course-id="${esc(next.course.id)}" data-activity-id="${esc(next.activity.id)}" type="button">Continuar →</button></div>` : `<div class="lms-empty-state"><strong>${courses.length ? "Todo está al día" : "No hay cursos disponibles"}</strong><p>Las próximas actividades aparecerán aquí.</p></div>`}${last ? `<div class="student-last-row"><span>Última actividad</span><strong>${esc(last.activity.title)}</strong><small>${esc(last.course.name)}</small></div>` : ""}</section><aside class="overview-panel student-todo-panel"><div class="overview-panel-head"><div><span class="eyebrow">POR HACER</span><h3>Evaluaciones pendientes</h3></div><span class="todo-count">${pendingExams}</span></div><div class="student-todo-list">${pendingList.length ? pendingList.map(exam => `<button class="start-exam" data-id="${esc(exam.id)}" type="button"><span>${modernIcon("quiz")}</span><span><strong>${esc(exam.title)}</strong><small>${esc(findCourse(exam.courseId)?.name || "Curso")} · ${exam.minutes} min</small></span><b>›</b></button>`).join("") : `<p class="lms-empty-note">No tienes evaluaciones pendientes.</p>`}</div></aside></div>`;
}
function renderStudentCourseModules(course, myGrades) {
  const modules = normalizeModules(course.modules);
  if (!modules.length) return "";
  const progress = courseProgress[course.id] || { completed: {}, lastActivityId:"" };
  const activities = modules.flatMap(module => module.activities);
  const completedCount = activities.filter(activity => progress.completed?.[activity.id]).length;
  const percent = activities.length ? Math.round(completedCount * 100 / activities.length) : 0;
  const accessibleActivities = accessibleCourseActivities(course);
  const lastAccessible = accessibleActivities.find(activity => activity.id === progress.lastActivityId);
  const next = accessibleActivities.find(activity => !progress.completed?.[activity.id]);
  const target = lastAccessible?.id || next?.id || accessibleActivities[0]?.id || "";
  let previousComplete = true;
  return `<section class="student-module-space"><div class="course-progress-summary"><div><span>Progreso del curso</span><strong>${percent}% completado</strong><small>${completedCount} realizadas · ${activities.length - completedCount} pendientes</small></div><div class="course-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>${target ? `<button class="btn primary continue-course" data-course-id="${esc(course.id)}" data-activity-id="${esc(target)}" type="button">Continuar curso</button>` : ""}</div>
    <div class="student-module-list">${modules.map((module, index) => {
      const passedEvaluation = myGrades.some(grade => grade.courseId === course.id && Number(grade.score) >= 11);
      const dateAvailable = module.unlockRule !== "date" || (module.unlockDetail && new Date(module.unlockDetail) <= new Date());
      const locked = (module.unlockRule === "previous" && !previousComplete) || (module.unlockRule === "evaluation" && !passedEvaluation) || !dateAvailable;
      const moduleComplete = module.activities.length > 0 && module.activities.every(activity => progress.completed?.[activity.id]);
      const markup = `<details class="student-module ${locked ? "is-locked" : ""}" ${index === 0 && !locked ? "open" : ""}><summary><span class="module-order">${index + 1}</span><span><strong>${esc(module.title)}</strong><small>${locked ? `🔒 ${unlockRuleLabel(module, index)}` : `${quantity(module.activities.length, "actividad", "actividades")} · ${moduleComplete ? "Completado" : "En progreso"}`}</small></span><b>${moduleComplete ? "✓" : locked ? "🔒" : "⌄"}</b></summary>${locked ? `<p class="module-lock-message">Este módulo está bloqueado. ${unlockRuleLabel(module, index)}.</p>` : `<div class="student-activity-list">${module.activities.length ? module.activities.map(activity => { const completed = Boolean(progress.completed?.[activity.id]); const inProgress = !completed && progress.lastActivityId === activity.id; return `<div class="student-activity" id="activity-${esc(activity.id)}"><span class="activity-type-icon">${modernIcon(activity.type)}</span><button class="open-lesson" data-course-id="${esc(course.id)}" data-activity-id="${esc(activity.id)}" type="button"><strong>${esc(activity.title)}</strong><small>${activityTypeLabel(activity.type)} · ${completed ? "Completado" : inProgress ? "En progreso" : "No iniciado"}</small></button><button class="student-activity-action ${completed ? "is-complete" : ""}" data-course-id="${esc(course.id)}" data-activity-id="${esc(activity.id)}" type="button" aria-label="${completed ? "Marcar como pendiente" : "Marcar como completado"}">${completed ? "✓" : "○"}</button></div>`; }).join("") : `<p class="module-empty">No hay actividades publicadas.</p>`}</div>`}</details>`;
      previousComplete = moduleComplete;
      return markup;
    }).join("")}</div></section>`;
}
function toggleActivityProgress(courseId, activityId) {
  const progress = courseProgress[courseId] || { completed:{}, lastActivityId:"" };
  progress.completed = { ...(progress.completed || {}), [activityId]: !progress.completed?.[activityId] };
  progress.lastActivityId = activityId;
  courseProgress[courseId] = progress;
  saveCourseProgress();
  renderStudent();
}
function accessibleCourseActivities(course) {
  const modules = normalizeModules(course.modules);
  const progress = courseProgress[course.id] || { completed:{} };
  const myGrades = results.filter(grade => grade.studentId === currentUser.id);
  const accessible = [];
  let previousComplete = true;
  modules.forEach((module, moduleIndex) => {
    const passedEvaluation = myGrades.some(grade => grade.courseId === course.id && Number(grade.score) >= 11);
    const dateAvailable = module.unlockRule !== "date" || (module.unlockDetail && new Date(module.unlockDetail) <= new Date());
    const locked = (module.unlockRule === "previous" && moduleIndex > 0 && !previousComplete) || (module.unlockRule === "evaluation" && !passedEvaluation) || !dateAvailable;
    if (!locked) module.activities.forEach(activity => accessible.push({ ...activity, moduleId:module.id, moduleTitle:module.title, moduleIndex }));
    previousComplete = module.activities.length > 0 && module.activities.every(activity => progress.completed?.[activity.id]);
  });
  return accessible;
}
function openLesson(courseId, activityId) {
  const course = publishedCourses.find(item => item.id === courseId);
  if (!course || !accessibleCourseActivities(course).some(activity => activity.id === activityId)) return;
  activeLessonCourseId = courseId;
  activeLessonActivityId = activityId;
  activeLessonTab = "description";
  const progress = courseProgress[courseId] || { completed:{}, lastActivityId:"" };
  progress.lastActivityId = activityId;
  courseProgress[courseId] = progress;
  saveCourseProgress();
  renderLesson();
}
function safeActivityUrl(value) {
  const url = String(value || "").trim();
  return /^(https?:\/\/|\.\/|\/)/i.test(url) ? url : "";
}
function youtubeEmbedUrl(url) {
  const match = String(url || "").match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  return match ? `https://www.youtube-nocookie.com/embed/${match[1]}` : "";
}
function lessonMediaMarkup(activity) {
  const url = safeActivityUrl(activity.url);
  if (activity.type === "video") {
    const youtube = youtubeEmbedUrl(url);
    if (youtube) return `<div class="lesson-video-frame"><iframe src="${esc(youtube)}" title="Video: ${esc(activity.title)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
    if (url && /\.(mp4|webm|ogg)(?:\?|$)/i.test(url)) return `<video controls preload="metadata"><source src="${esc(url)}">Tu navegador no puede reproducir este video.</video>`;
    return `<div class="lesson-media-placeholder"><span>${modernIcon("video")}</span><strong>Clase en video</strong><p>${url ? "Usa el enlace del material para abrir el recurso audiovisual." : "El profesor todavía no ha agregado el video de esta clase."}</p></div>`;
  }
  if (activity.type === "pdf" && url) return `<div class="lesson-document-preview"><span>${modernIcon("pdf")}</span><div><strong>Documento de la clase</strong><p>Consulta el PDF en una pestaña nueva o descárgalo para estudiar sin conexión.</p></div><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir PDF</a></div>`;
  return `<div class="lesson-media-placeholder compact"><span>${modernIcon(activity.type)}</span><strong>${activityTypeLabel(activity.type)}</strong><p>Revisa la explicación, los materiales y los recursos asociados a esta actividad.</p></div>`;
}
function renderLesson() {
  const course = publishedCourses.find(item => item.id === activeLessonCourseId);
  const activities = course ? accessibleCourseActivities(course) : [];
  const activityIndex = activities.findIndex(activity => activity.id === activeLessonActivityId);
  if (!course || activityIndex < 0) { renderStudent(); return; }
  const activity = activities[activityIndex];
  const progress = courseProgress[course.id] || { completed:{}, lastActivityId:"" };
  const allActivities = normalizeModules(course.modules).flatMap(module => module.activities);
  const completedCount = allActivities.filter(item => progress.completed?.[item.id]).length;
  const percent = allActivities.length ? Math.round(completedCount * 100 / allActivities.length) : 0;
  $("#lesson-sidebar-course").textContent = course.name;
  $("#lesson-title").textContent = activity.title;
  $("#lesson-type").textContent = `${activity.moduleTitle} · ${activityTypeLabel(activity.type)}`;
  $("#lesson-description").textContent = activity.description || "Avanza a tu ritmo y marca esta actividad como completada cuando termines.";
  $("#lesson-media").innerHTML = lessonMediaMarkup(activity);
  $("#lesson-progress-label").textContent = `${percent}% completado`;
  $("#lesson-progress-bar").style.width = `${percent}%`;
  const completed = Boolean(progress.completed?.[activity.id]);
  $("#lesson-complete").textContent = completed ? "✓ Actividad completada" : "Marcar como completado";
  $("#lesson-complete").classList.toggle("completed-button", completed);
  $("#lesson-previous").disabled = activityIndex === 0;
  $("#lesson-next").disabled = activityIndex === activities.length - 1;
  $("#lesson-position").textContent = `${activityIndex + 1} de ${activities.length}`;
  const url = safeActivityUrl(activity.url);
  $("#lesson-materials-card").innerHTML = url ? `<div><span class="activity-type-icon">${modernIcon(activity.type === "video" ? "download" : activity.type)}</span><span><strong>Material de la actividad</strong><small>${activityTypeLabel(activity.type)} disponible</small></span></div><a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener">Abrir recurso ↗</a>` : `<div><span class="activity-type-icon">${modernIcon("download")}</span><span><strong>Materiales descargables</strong><small>No hay archivos adicionales para esta clase.</small></span></div>`;
  renderLessonTree(course, activity.id);
  renderLessonTabs();
  show("lesson-view");
  closeLessonSidebar();
}
function renderLessonTree(course, activeActivityId) {
  const accessibleIds = new Set(accessibleCourseActivities(course).map(activity => activity.id));
  const progress = courseProgress[course.id] || { completed:{} };
  $("#lesson-module-tree").innerHTML = normalizeModules(course.modules).map((module, index) => {
    const moduleAccessible = module.activities.some(activity => accessibleIds.has(activity.id)) || !module.activities.length;
    return `<details class="lesson-tree-module ${moduleAccessible ? "" : "is-locked"}" ${module.activities.some(activity => activity.id === activeActivityId) ? "open" : ""}><summary><span>${index + 1}</span><strong>${esc(module.title)}</strong><b>${moduleAccessible ? "⌄" : "🔒"}</b></summary><div>${moduleAccessible ? module.activities.map(activity => `<button class="lesson-tree-activity ${activity.id === activeActivityId ? "active" : ""}" data-activity-id="${esc(activity.id)}" type="button" ${accessibleIds.has(activity.id) ? "" : "disabled"}><span>${modernIcon(activity.type)}</span><span><strong>${esc(activity.title)}</strong><small>${progress.completed?.[activity.id] ? "Completado" : activity.id === activeActivityId ? "En progreso" : "No iniciado"}</small></span><b>${progress.completed?.[activity.id] ? "✓" : ""}</b></button>`).join("") : `<p>Completa el requisito anterior para desbloquearlo.</p>`}</div></details>`;
  }).join("");
  $$(".lesson-tree-activity:not(:disabled)").forEach(button => button.addEventListener("click", () => openLesson(course.id, button.dataset.activityId)));
}
function renderLessonTabs() {
  const course = publishedCourses.find(item => item.id === activeLessonCourseId);
  const activity = course ? accessibleCourseActivities(course).find(item => item.id === activeLessonActivityId) : null;
  if (!activity) return;
  $$(".lesson-tab").forEach(button => button.classList.toggle("active", button.dataset.lessonTab === activeLessonTab));
  const url = safeActivityUrl(activity.url);
  const contents = {
    description: `<h3>Descripción de la clase</h3><p>${esc(activity.description || "Esta actividad forma parte de tu ruta de aprendizaje. Revisa el contenido principal y completa los materiales indicados antes de continuar.")}</p><div class="lesson-objective"><strong>Objetivo</strong><span>Comprender y aplicar los conceptos presentados en ${esc(activity.title)}.</span></div>`,
    materials: `<h3>Materiales</h3>${url ? `<a class="lesson-resource-row" href="${esc(url)}" target="_blank" rel="noopener"><span>${modernIcon(activity.type)}</span><span><strong>${esc(activity.title)}</strong><small>Abrir material asociado</small></span><b>↗</b></a>` : `<p class="muted">Esta clase no tiene materiales adicionales.</p>`}`,
    evaluation: `<h3>Evaluación</h3><p>${activity.type === "quiz" ? "Completa la evaluación indicada por tu profesor desde la sección de evaluaciones del curso." : "No hay una evaluación vinculada directamente a esta clase."}</p>`,
    comments: `<h3>Comentarios</h3><p class="muted">El espacio de comentarios estará disponible en una próxima etapa.</p>`,
    resources: `<h3>Recursos descargables</h3>${url && ["pdf","download"].includes(activity.type) ? `<a class="btn secondary" href="${esc(url)}" target="_blank" rel="noopener">Descargar o abrir recurso</a>` : `<p class="muted">No se han agregado recursos descargables.</p>`}`
  };
  $("#lesson-tab-content").innerHTML = contents[activeLessonTab] || contents.description;
}
function completeActiveLesson() {
  const progress = courseProgress[activeLessonCourseId] || { completed:{}, lastActivityId:"" };
  progress.completed = { ...(progress.completed || {}), [activeLessonActivityId]: !progress.completed?.[activeLessonActivityId] };
  progress.lastActivityId = activeLessonActivityId;
  courseProgress[activeLessonCourseId] = progress;
  saveCourseProgress();
  renderLesson();
}
function navigateLesson(direction) {
  const course = publishedCourses.find(item => item.id === activeLessonCourseId);
  const activities = course ? accessibleCourseActivities(course) : [];
  const index = activities.findIndex(activity => activity.id === activeLessonActivityId);
  const target = activities[index + direction];
  if (target) openLesson(course.id, target.id);
}
function toggleLessonSidebar() {
  const open = document.body.classList.toggle("lesson-sidebar-open");
  $("#lesson-menu-toggle").setAttribute("aria-expanded", String(open));
}
function closeLessonSidebar() {
  document.body.classList.remove("lesson-sidebar-open");
  $("#lesson-menu-toggle").setAttribute("aria-expanded", "false");
}
function renderStudentExamRow(exam, myGrades) {
  const attempts = myGrades.filter(item => item.examId === exam.id);
  const best = attempts.length ? Math.max(...attempts.map(item => item.score)) : null;
  const reviewButton = attempts.length >= exam.attemptsAllowed && attempts.some(item => item.review?.length) ? `<button class="btn secondary review-exam" data-id="${esc(exam.id)}">Revisar intentos</button>` : "";
  return `<div class="exam-row"><div><strong>${esc(exam.title)}</strong><small>${quantity(exam.questionsToShow, "pregunta")} · ${exam.minutes} minutos · ${quantity(exam.attemptsAllowed, "intento permitido", "intentos permitidos")}</small></div><div class="attempt-actions">${best !== null ? `<span class="completed">Mejor nota: ${best}/20</span>` : ""}${attempts.length < exam.attemptsAllowed ? `<button class="btn primary start-exam" data-id="${esc(exam.id)}">${attempts.length ? "Intentar nuevamente" : "Rendir examen"}</button>` : `<span class="attempts-finished">Intentos completados</span>${reviewButton}`}</div></div>`;
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
  $("#questions-container").innerHTML = activeQuestions.map((question, index) => `<article class="question-card" data-question-id="${esc(question.id)}"><div class="question-card-head"><span class="question-number">Pregunta ${index + 1} <small>de ${activeQuestions.length}</small></span><span class="question-status">Pendiente</span></div><h3>${esc(question.text)}</h3>${questionImageMarkup(question)}<div class="options-list">${question.options.map((option, i) => `<label class="option"><input type="radio" name="q-${esc(question.id)}" value="${i}"><span class="option-letter" aria-hidden="true">${"ABCDEFGH"[i] || i + 1}</span><span class="option-copy">${esc(option)}</span><span class="option-check" aria-hidden="true">✓</span></label>`).join("")}</div></article>`).join("");
  $("#take-exam-form").querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener("change", () => { updateQuestionCardState(input); updateExamProgress(); saveActiveAttempt(); }));
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
  const percentage = activeQuestions.length ? (answered / activeQuestions.length) * 100 : 0;
  $("#exam-progress-bar").style.width = `${percentage}%`;
  $("#exam-progress-track").setAttribute("aria-valuemax", String(activeQuestions.length));
  $("#exam-progress-track").setAttribute("aria-valuenow", String(answered));
  $("#exam-progress-track").classList.toggle("complete", answered === activeQuestions.length && activeQuestions.length > 0);
}
function updateQuestionCardState(input) {
  const card = input.closest(".question-card");
  if (!card) return;
  card.classList.add("answered");
  const status = card.querySelector(".question-status");
  if (status) status.textContent = "Respondida ✓";
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
async function syncPendingResults(shouldRender = true) {
  if (!sb || !currentUser || !pendingResults.length || !navigator.onLine) return;
  for (const payload of [...pendingResults]) {
    const ok = await syncOneResult(payload);
    if (ok) removePending(payload.submission_id);
  }
  await refreshResults();
  if (currentUser && shouldRender) renderApp();
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
function refreshActiveCourseWorkspace() {
  renderTeacherExamWorkspace(getTeacherCourses(), getTeacherExams());
  bindTeacherExamWorkspaceActions();
}
async function saveLegacyCourseModules(courseId, modules) {
  const prefix = legacyModulePrefix(courseId);
  const serialized = JSON.stringify(normalizeModules(modules));
  const chunks = serialized.match(/[\s\S]{1,220}/g) || ["[]"];
  const { data: existing, error: selectError } = await sb.from("course_changes").select("course_id").like("course_id", `${prefix}%`);
  if (selectError) return { error: selectError };
  const rows = chunks.map((chunk, index) => ({
    course_id: `${prefix}${String(index).padStart(4,"0")}`,
    name: `Contenido ${index + 1}/${chunks.length}`,
    description: chunk,
    deleted: false,
    updated_by: currentUser.id
  }));
  const { error } = await sb.from("course_changes").upsert(rows, { onConflict:"course_id" });
  if (error) return { error };
  const activeIds = new Set(rows.map(row => row.course_id));
  const staleIds = (existing || []).map(row => row.course_id).filter(id => !activeIds.has(id));
  if (staleIds.length) {
    const { error: cleanupError } = await sb.from("course_changes").delete().in("course_id", staleIds);
    if (cleanupError) console.warn("No se pudieron limpiar fragmentos antiguos de módulos:", cleanupError);
  }
  return { error:null };
}
async function removeLegacyCourseModules(courseId) {
  const prefix = legacyModulePrefix(courseId);
  const { error } = await sb.from("course_changes").delete().like("course_id", `${prefix}%`);
  if (error) console.warn("No se pudo retirar el respaldo compatible de módulos:", error);
}
function showCourseContentError(error) {
  console.error("Guardar contenido del curso:", error);
  const target = !$("#module-modal")?.classList.contains("hidden") ? $("#module-error") : $("#activity-error");
  if (target) target.textContent = error?.message || translateError(error);
}
async function updateCourseModules(courseId, transform) {
  const localIndex = drafts.courses.findIndex(course => course.id === courseId);
  const course = findCourse(courseId);
  if (!course) return false;
  const modules = normalizeModules(transform(normalizeModules(course.modules)));
  if (localIndex >= 0) {
    drafts.courses[localIndex] = { ...drafts.courses[localIndex], modules, updatedAt: nowIso() };
    saveDrafts();
  } else {
    const { error } = await sb.from("course_changes").upsert({ course_id: courseId, name: course.name, description: course.description || "", modules, deleted: false, updated_by: currentUser.id }, { onConflict: "course_id" });
    if (error && isMissingModulesColumn(error)) {
      const compatibleSave = await saveLegacyCourseModules(courseId, modules);
      if (compatibleSave.error) { showCourseContentError(compatibleSave.error); return false; }
    } else if (error) {
      showCourseContentError(error);
      return false;
    } else await removeLegacyCourseModules(courseId);
    await loadCourseChanges();
  }
  refreshActiveCourseWorkspace();
  return true;
}
function toggleModuleUnlockDetail() {
  const needsDetail = ["evaluation","date"].includes($("#module-unlock-rule").value);
  $("#module-unlock-detail-field").classList.toggle("hidden", !needsDetail);
  $("#module-unlock-detail").required = needsDetail;
}
function openModuleModal(courseId, moduleId = "") {
  const module = normalizeModules(findCourse(courseId)?.modules).find(item => item.id === moduleId);
  $("#module-modal-title").textContent = module ? "Editar módulo" : "Crear módulo";
  $("#module-course-id").value = courseId;
  $("#module-id").value = module?.id || "";
  $("#module-title").value = module?.title || "";
  $("#module-unlock-rule").value = module?.unlockRule || "immediate";
  $("#module-unlock-detail").value = module?.unlockDetail || "";
  $("#module-error").textContent = "";
  toggleModuleUnlockDetail();
  $("#module-modal").classList.remove("hidden");
  $("#module-title").focus();
}
async function saveModule(event) {
  event.preventDefault();
  const courseId = $("#module-course-id").value;
  const moduleId = $("#module-id").value;
  const title = $("#module-title").value.trim();
  const unlockRule = $("#module-unlock-rule").value;
  const unlockDetail = $("#module-unlock-detail").value.trim();
  if (!title) { $("#module-error").textContent = "Escribe un nombre para el módulo."; return; }
  const saved = await updateCourseModules(courseId, modules => moduleId
    ? modules.map(module => module.id === moduleId ? { ...module, title, unlockRule, unlockDetail } : module)
    : [...modules, { id: uid(), title, unlockRule, unlockDetail, activities: [] }]);
  if (saved) closeModal("module-modal");
}
function openActivityModal(courseId, moduleId, activityId = "") {
  const module = normalizeModules(findCourse(courseId)?.modules).find(item => item.id === moduleId);
  const activity = module?.activities.find(item => item.id === activityId);
  $("#activity-modal-title").textContent = activity ? "Editar actividad" : "Crear actividad";
  $("#activity-course-id").value = courseId;
  $("#activity-module-id").value = moduleId;
  $("#activity-id").value = activity?.id || "";
  $("#activity-title").value = activity?.title || "";
  $("#activity-type").value = activity?.type || "lesson";
  $("#activity-url").value = activity?.url || "";
  $("#activity-description").value = activity?.description || "";
  $("#activity-error").textContent = "";
  $("#activity-modal").classList.remove("hidden");
  $("#activity-title").focus();
}
async function saveActivity(event) {
  event.preventDefault();
  const courseId = $("#activity-course-id").value;
  const moduleId = $("#activity-module-id").value;
  const activityId = $("#activity-id").value;
  const activity = { id: activityId || uid(), title: $("#activity-title").value.trim(), type: $("#activity-type").value, url: $("#activity-url").value.trim(), description: $("#activity-description").value.trim() };
  if (!activity.title) { $("#activity-error").textContent = "Escribe un nombre para la actividad."; return; }
  const saved = await updateCourseModules(courseId, modules => modules.map(module => module.id === moduleId ? { ...module, activities: activityId ? module.activities.map(item => item.id === activityId ? activity : item) : [...module.activities, activity] } : module));
  if (saved) closeModal("activity-modal");
}
async function deleteModule(courseId, moduleId) {
  if (!confirm("¿Eliminar este módulo y todas sus actividades?")) return;
  await updateCourseModules(courseId, modules => modules.filter(module => module.id !== moduleId));
}
async function deleteActivity(courseId, moduleId, activityId) {
  if (!confirm("¿Eliminar esta actividad?")) return;
  await updateCourseModules(courseId, modules => modules.map(module => module.id === moduleId ? { ...module, activities: module.activities.filter(activity => activity.id !== activityId) } : module));
}
async function moveModule(courseId, moduleId, direction) {
  await updateCourseModules(courseId, modules => { const index = modules.findIndex(module => module.id === moduleId); const target = index + (direction === "up" ? -1 : 1); if (index < 0 || target < 0 || target >= modules.length) return modules; [modules[index], modules[target]] = [modules[target], modules[index]]; return modules; });
}
async function moveActivity(courseId, moduleId, activityId, direction) {
  await updateCourseModules(courseId, modules => modules.map(module => { if (module.id !== moduleId) return module; const activities = [...module.activities]; const index = activities.findIndex(activity => activity.id === activityId); const target = index + (direction === "up" ? -1 : 1); if (index >= 0 && target >= 0 && target < activities.length) [activities[index], activities[target]] = [activities[target], activities[index]]; return { ...module, activities }; }));
}
function bindModuleDragAndDrop() {
  $$(".module-drag-handle").forEach(handle => {
    handle.addEventListener("dragstart", event => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", JSON.stringify({ kind:"module", courseId:handle.dataset.courseId, moduleId:handle.dataset.moduleId }));
      handle.closest(".teacher-module-card")?.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", clearDragStyles);
  });
  $$(".activity-drag-handle").forEach(handle => {
    handle.addEventListener("dragstart", event => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", JSON.stringify({ kind:"activity", courseId:handle.dataset.courseId, moduleId:handle.dataset.moduleId, activityId:handle.dataset.activityId }));
      handle.closest(".teacher-activity-row")?.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", clearDragStyles);
  });
  $$("[data-activity-drop]").forEach(row => {
    row.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); row.classList.add("is-drag-over"); });
    row.addEventListener("dragleave", () => row.classList.remove("is-drag-over"));
    row.addEventListener("drop", event => {
      event.preventDefault(); event.stopPropagation();
      const payload = readDragPayload(event);
      clearDragStyles();
      if (payload?.kind === "activity" && payload.courseId === row.dataset.courseId) reorderActivityDrop(payload.courseId, payload.moduleId, payload.activityId, row.dataset.moduleId, row.dataset.activityDrop);
    });
  });
  $$("[data-module-drop]").forEach(card => {
    card.addEventListener("dragover", event => { event.preventDefault(); card.classList.add("is-drag-over"); });
    card.addEventListener("dragleave", event => { if (!card.contains(event.relatedTarget)) card.classList.remove("is-drag-over"); });
    card.addEventListener("drop", event => {
      event.preventDefault();
      const payload = readDragPayload(event);
      clearDragStyles();
      if (!payload || payload.courseId !== card.dataset.courseId) return;
      if (payload.kind === "module") reorderModuleDrop(payload.courseId, payload.moduleId, card.dataset.moduleDrop);
      if (payload.kind === "activity") reorderActivityDrop(payload.courseId, payload.moduleId, payload.activityId, card.dataset.moduleDrop);
    });
  });
}
function readDragPayload(event) {
  try { return JSON.parse(event.dataTransfer.getData("text/plain")); }
  catch { return null; }
}
function clearDragStyles() {
  $$(".is-dragging,.is-drag-over").forEach(element => element.classList.remove("is-dragging","is-drag-over"));
}
async function reorderModuleDrop(courseId, sourceModuleId, targetModuleId) {
  if (sourceModuleId === targetModuleId) return;
  await updateCourseModules(courseId, modules => {
    const sourceIndex = modules.findIndex(module => module.id === sourceModuleId);
    const targetIndex = modules.findIndex(module => module.id === targetModuleId);
    if (sourceIndex < 0 || targetIndex < 0) return modules;
    const [moved] = modules.splice(sourceIndex, 1);
    modules.splice(modules.findIndex(module => module.id === targetModuleId), 0, moved);
    return modules;
  });
}
async function reorderActivityDrop(courseId, sourceModuleId, activityId, targetModuleId, targetActivityId = "") {
  if (sourceModuleId === targetModuleId && activityId === targetActivityId) return;
  await updateCourseModules(courseId, modules => {
    const sourceModule = modules.find(module => module.id === sourceModuleId);
    const targetModule = modules.find(module => module.id === targetModuleId);
    const sourceIndex = sourceModule?.activities.findIndex(activity => activity.id === activityId) ?? -1;
    if (!sourceModule || !targetModule || sourceIndex < 0) return modules;
    const [moved] = sourceModule.activities.splice(sourceIndex, 1);
    const targetIndex = targetActivityId ? targetModule.activities.findIndex(activity => activity.id === targetActivityId) : -1;
    targetModule.activities.splice(targetIndex < 0 ? targetModule.activities.length : targetIndex, 0, moved);
    return modules;
  });
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
  $("#course-breadcrumb-current").textContent = course ? "Editar curso" : "Nuevo curso";
  $("#course-setup-status").textContent = publishedCourse ? "Curso publicado" : "Borrador local";
  $("#course-setup-status").classList.toggle("published", Boolean(publishedCourse));
  $("#course-id").value = course?.id || "";
  $("#course-name").value = course?.name || "";
  $("#course-description").value = course?.description || "";
  $("#course-error").textContent = "";
  updateCourseSetupPreview();
  $("#course-modal").classList.remove("hidden");
  $("#course-name").focus();
}
function updateCourseSetupPreview() {
  const id = $("#course-id")?.value || "";
  const course = findCourse(id);
  const name = $("#course-name")?.value.trim() || "Nuevo curso";
  const description = $("#course-description")?.value.trim() || "Agrega una descripción para orientar a tus estudiantes.";
  const modules = normalizeModules(course?.modules);
  const activities = modules.reduce((total, module) => total + module.activities.length, 0);
  const exams = getTeacherExams().filter(exam => exam.courseId === id).length;
  $("#course-preview-initial").textContent = name.charAt(0).toLocaleUpperCase("es");
  $("#course-preview-name").textContent = name;
  $("#course-preview-description").textContent = description;
  $("#course-description-count").textContent = `${$("#course-description").value.length} / 250`;
  $("#course-module-preview-count").textContent = modules.length;
  $("#course-activity-preview-count").textContent = activities;
  $("#course-exam-preview-count").textContent = exams;
}
function toggleSidebar() {
  const mobile = matchMedia("(max-width: 900px)").matches;
  const visible = mobile ? document.body.classList.toggle("sidebar-open") : !document.body.classList.toggle("sidebar-collapsed");
  $("#sidebar-toggle").setAttribute("aria-expanded", String(visible));
  $("#sidebar-toggle").setAttribute("aria-label", visible ? "Ocultar barra lateral" : "Mostrar barra lateral");
  $("#sidebar-toggle").setAttribute("title", visible ? "Ocultar barra lateral" : "Mostrar barra lateral");
}
async function saveCourseDraft(event) {
  event.preventDefault();
  const id = $("#course-id").value;
  const existingCourse = findCourse(id);
  const course = { id: id || slug($("#course-name").value), name: $("#course-name").value.trim(), description: $("#course-description").value.trim(), teacherName: currentUser.name, modules: normalizeModules(existingCourse?.modules), local: true, updatedAt: nowIso() };
  if (id && publishedCourses.some(item => item.id === id)) {
    const submit = event.submitter;
    if (submit) submit.disabled = true;
    $("#course-error").textContent = "";
    const { error } = await sb.from("course_changes").upsert({ course_id: id, name: course.name, description: course.description, modules: course.modules, deleted: false, updated_by: currentUser.id }, { onConflict: "course_id" });
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
  const localExam = drafts.exams.find(item => item.id === id);
  const publishedExam = publishedExams.find(item => item.id === id);
  const exam = localExam || publishedExam;
  $("#exam-modal-title").textContent = publishedExam ? "Modificar examen publicado" : localExam ? "Editar borrador de examen" : "Crear borrador de examen";
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
async function saveExamDraft(event) {
  event.preventDefault();
  const exam = validateCurrentExam(false);
  if (!exam) return;
  const id = $("#editor-exam-id").value;
  const publishedExam = publishedExams.find(item => item.id === id);
  const publishedCourse = publishedCourses.find(item => item.id === exam.courseId);
  const shouldPublish = Boolean(publishedExam || (exam.published && publishedCourse));
  if (shouldPublish) {
    const submit = event.submitter || $(".editor-save");
    const course = publishedCourse || findCourse(exam.courseId);
    if (!sb || !course) {
      $("#exam-editor-error").textContent = "No se pudo conectar el examen con su curso publicado.";
      return;
    }
    if (submit) submit.disabled = true;
    $("#exam-editor-error").className = "muted";
    $("#exam-editor-error").textContent = "Guardando y verificando los cambios...";
    try {
      const payload = {
        course: { id: course.id, name: course.name, description: course.description || "", teacher_name: course.teacherName || currentUser.name, modules: normalizeModules(course.modules) },
        exams: [{ ...examToJsonSchema(exam), published: true }]
      };
      const { data, error } = await sb.rpc("publish_academy_course", { payload });
      if (error) throw error;
      if (!data || data.course_id !== course.id || Number(data.exam_count) !== 1) throw new Error("Supabase no confirmó la publicación del examen.");
      await loadCourseChanges();
      const verified = publishedExams.find(item => item.id === exam.id && item.courseId === exam.courseId);
      if (!verified || verified.title !== exam.title || verified.minutes !== exam.minutes || verified.questions.length !== exam.questions.length) {
        throw new Error("No se pudo verificar el examen publicado completo.");
      }
      drafts.exams = drafts.exams.filter(item => item.id !== exam.id);
      saveDrafts();
      closeModal("exam-modal");
      renderTeacher();
    } catch (error) {
      console.error("Publicar examen:", error);
      $("#exam-editor-error").className = "error";
      $("#exam-editor-error").textContent = error.message || translateError(error);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }
  const draftIndex = drafts.exams.findIndex(item => item.id === exam.id);
  if (draftIndex >= 0) drafts.exams[draftIndex] = exam; else drafts.exams.push(exam);
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
