const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const errorEl = document.querySelector("#auth-error");

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("is-on"));
    tab.classList.add("is-on");
    const isLogin = tab.dataset.tab === "login";
    loginForm.classList.toggle("hidden", !isLogin);
    registerForm.classList.toggle("hidden", isLogin);
    showError("");
  });
});

document.querySelector("#demo-fill").addEventListener("click", () => {
  loginForm.email.value = "demo@pifpafai.com";
  loginForm.password.value = "pifpaf";
  loginForm.requestSubmit();
});

async function send(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не получилось");
  return data;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  try {
    await send("/api/auth/login", {
      email: loginForm.email.value,
      password: loginForm.password.value,
    });
    location.href = "/app";
  } catch (error) {
    showError(error.message);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  try {
    await send("/api/auth/register", {
      name: registerForm.name.value,
      handle: registerForm.handle.value,
      email: registerForm.email.value,
      password: registerForm.password.value,
    });
    location.href = "/app";
  } catch (error) {
    showError(error.message);
  }
});
