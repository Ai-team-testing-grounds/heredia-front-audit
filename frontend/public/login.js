const form = document.getElementById("loginForm");
const errorEl = document.getElementById("loginError");
const btn = document.getElementById("loginBtn");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) return showError("Enter your email and password.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");

  showError("");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return location.assign("/dashboard");
    showError((await res.json()).error || "Sign in failed.");
  } catch {
    showError("Can't reach the server. Try again.");
  }
  btn.disabled = false;
  btn.textContent = "Sign in";
});
