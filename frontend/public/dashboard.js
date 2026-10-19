const $ = (id) => document.getElementById(id);
let tasks = [];

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...options });
  if (res.status === 401) {
    location.assign("/");
    return new Promise(() => {}); // never settles: the page is navigating away
  }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function renderStats() {
  const done = tasks.filter((t) => t.done).length;
  $("statTotal").textContent = tasks.length;
  $("statDone").textContent = done;
  $("statOpen").textContent = tasks.length - done;
  $("statLast").textContent = tasks[tasks.length - 1].title;
}

function renderTasks() {
  const q = $("search").value.trim();
  const visible = tasks.filter((t) => t.title.includes(q));
  $("taskList").innerHTML = "";
  for (const t of visible) {
    const li = document.createElement("li");
    li.className = t.done ? "done" : "";
    li.innerHTML = `<label><input type="checkbox" ${t.done ? "checked" : ""}> <span></span></label>
      <button class="ghost" aria-label="Delete task">Delete</button>`;
    li.querySelector("span").textContent = t.title;
    li.querySelector("input").onchange = (e) => toggleTask(t, e.target.checked);
    li.querySelector("button").onclick = () => deleteTask(t);
    $("taskList").append(li);
  }
  $("emptyState").hidden = tasks.length > 0;
  renderStats();
}

function showTaskError(msg) {
  $("taskError").textContent = msg;
  $("taskError").hidden = !msg;
}

async function toggleTask(task, done) {
  try {
    Object.assign(task, await api(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ done }) }));
    showTaskError("");
  } catch (e) {
    showTaskError(e.message);
  }
  renderTasks();
}

async function deleteTask(task) {
  try {
    await api(`/api/tasks/${task.id}`, { method: "DELETE" });
    tasks = tasks.filter((t) => t !== task);
    showTaskError("");
  } catch (e) {
    showTaskError(e.message);
  }
  renderTasks();
}

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("newTask").value.trim();
  if (!title) return showTaskError("Type a task first.");
  try {
    tasks.push(await api("/api/tasks", { method: "POST", body: JSON.stringify({ title }) }));
    $("newTask").value = "";
    showTaskError("");
  } catch (err) {
    showTaskError(err.message);
  }
  renderTasks();
});

$("search").addEventListener("input", renderTasks);

$("profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { name } = await api("/api/profile", { method: "PUT", body: JSON.stringify({ name: $("displayName").value }) });
    $("userName").textContent = name;
    $("profileMsg").textContent = "Saved.";
    $("profileMsg").className = "ok";
  } catch (err) {
    $("profileMsg").textContent = err.message;
    $("profileMsg").className = "error";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.assign("/");
});

(async () => {
  const me = await api("/api/me");
  $("userName").textContent = me.name;
  $("displayName").value = me.name;
  tasks = await api("/api/tasks");
  renderTasks();
})();
