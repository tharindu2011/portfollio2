"use strict";

/* ==========================================================
   CONFIG — wire up your real backend / email service here.
   ==========================================================

   This app needs two things from a backend, since browsers can't
   send email or persist data on their own:

   1. An OTP service — something that emails a 6-digit code and can
      later confirm what the user typed matches. Options:
        - EmailJS (client-side email sending; you still need to
          generate/store/compare the OTP yourself, e.g. in
          localStorage/sessionStorage on a real backend, NOT just
          the browser, or the check can be spoofed)
        - Firebase Auth (email link / custom OTP via Cloud Functions)
        - Your own Node/Express + Nodemailer endpoint

   2. A messages API — a REST endpoint (or WebSocket) backed by a
      database (Firestore, Supabase, your own DB) that can accept
      new messages and list existing ones.

   Fill in API_BASE_URL and the endpoint paths below to match your
   backend. Until you do, MOCK_MODE keeps the UI fully working with
   an in-memory fake backend, so you can test the flow immediately.
   Set MOCK_MODE to false once your real endpoints are ready.
*/

const CONFIG = {
  MOCK_MODE: true, // <-- set to false once real endpoints exist below

  API_BASE_URL: "https://your-backend.example.com/api", // <-- your backend root

  ENDPOINTS: {
    sendOtp: "/auth/send-otp",       // POST { email } -> { ok: true }
    verifyOtp: "/auth/verify-otp",   // POST { email, code } -> { ok: true, token }
    postMessage: "/messages",        // POST { name, message, token } -> { ok: true, message }
    listMessages: "/messages",       // GET ?after=<timestamp> -> { messages: [...] }
  },

  // If using EmailJS instead of a custom backend for step 1, put your
  // keys here and call sendViaEmailJS() from requestOtp() below.
  EMAILJS: {
    PUBLIC_KEY: "YOUR_EMAILJS_PUBLIC_KEY",
    SERVICE_ID: "YOUR_EMAILJS_SERVICE_ID",
    TEMPLATE_ID: "YOUR_EMAILJS_TEMPLATE_ID",
  },

  POLL_INTERVAL_MS: 4000,
};

/* ==========================================================
   STATE
   ========================================================== */

const state = {
  email: null,
  authToken: null,
  lastMessageTimestamp: null,
  pollTimer: null,
};

/* ==========================================================
   DOM REFERENCES
   ========================================================== */

const els = {
  viewVerify: document.getElementById("view-verify"),
  viewFeed: document.getElementById("view-feed"),

  formRequestOtp: document.getElementById("form-request-otp"),
  emailInput: document.getElementById("email-input"),
  emailHint: document.getElementById("email-hint"),
  btnSendCode: document.getElementById("btn-send-code"),

  formVerifyOtp: document.getElementById("form-verify-otp"),
  otpInput: document.getElementById("otp-input"),
  otpHint: document.getElementById("otp-hint"),
  btnVerify: document.getElementById("btn-verify"),
  btnResend: document.getElementById("btn-resend"),
  sentToNotice: document.getElementById("sent-to-notice"),

  steps: document.getElementById("steps"),

  verifiedEmailLabel: document.getElementById("verified-email-label"),

  formPostMessage: document.getElementById("form-post-message"),
  messageName: document.getElementById("message-name"),
  messageBody: document.getElementById("message-body"),
  charCount: document.getElementById("char-count"),
  btnPost: document.getElementById("btn-post"),

  feedList: document.getElementById("feed-list"),
  feedEmpty: document.getElementById("feed-empty"),
  liveIndicator: document.getElementById("live-indicator"),

  toastRegion: document.getElementById("toast-region"),
};

/* ==========================================================
   UTILITIES
   ========================================================== */

function showToast(message, kind = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  els.toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function setFieldState(inputEl, hintEl, kind, message) {
  const field = inputEl.closest(".field");
  field.classList.remove("field--error", "field--success");
  hintEl.classList.remove("field__hint--error", "field__hint--success");
  hintEl.textContent = message || "";
  if (kind === "error") {
    field.classList.add("field--error");
    hintEl.classList.add("field__hint--error");
  } else if (kind === "success") {
    field.classList.add("field--success");
    hintEl.classList.add("field__hint--success");
  }
}

function setButtonLoading(btnEl, isLoading) {
  btnEl.classList.toggle("btn--loading", isLoading);
  btnEl.disabled = isLoading;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatTimestamp(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ==========================================================
   API LAYER
   Swap the MOCK_MODE branch for a real fetch() once your
   backend exists — the function signatures already match
   what a real backend should return.
   ========================================================== */

const mockBackend = {
  otpsByEmail: new Map(),
  messages: [
    {
      name: "Signal Bot",
      message: "Welcome! Verified messages will show up here in real time.",
      timestamp: Date.now() - 1000 * 60 * 5,
    },
  ],
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiSendOtp(email) {
  if (CONFIG.MOCK_MODE) {
    await delay(700);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    mockBackend.otpsByEmail.set(email, code);
    console.info(`[MOCK] OTP for ${email}: ${code}`); // visible for local testing only
    return { ok: true };
  }

  // --- Real backend call ---
  const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.sendOtp}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || "Failed to send verification code.");
  }
  return res.json();

  /* --- Alternative: sending via EmailJS instead of a custom backend ---
  // Requires the EmailJS SDK script tag and a server-generated code
  // stored somewhere you can verify against (EmailJS only sends mail,
  // it doesn't store or check codes for you).
  //
  // return emailjs.send(CONFIG.EMAILJS.SERVICE_ID, CONFIG.EMAILJS.TEMPLATE_ID, {
  //   to_email: email,
  //   otp_code: generatedCode,
  // }, CONFIG.EMAILJS.PUBLIC_KEY);
  */
}

async function apiVerifyOtp(email, code) {
  if (CONFIG.MOCK_MODE) {
    await delay(600);
    const expected = mockBackend.otpsByEmail.get(email);
    if (expected && expected === code) {
      return { ok: true, token: "mock-token" };
    }
    return { ok: false, message: "That code doesn't match. Try again." };
  }

  const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.verifyOtp}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, message: body.message || "Verification failed." };
  }
  return body;
}

async function apiPostMessage(name, message) {
  if (CONFIG.MOCK_MODE) {
    await delay(400);
    const entry = { name, message, timestamp: Date.now() };
    mockBackend.messages.push(entry);
    return { ok: true, message: entry };
  }

  const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.postMessage}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.authToken}`,
    },
    body: JSON.stringify({ name, message }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.message || "Failed to post message.");
  }
  return res.json();
}

async function apiListMessages(afterTimestamp) {
  if (CONFIG.MOCK_MODE) {
    await delay(200);
    const messages = afterTimestamp
      ? mockBackend.messages.filter((m) => m.timestamp > afterTimestamp)
      : mockBackend.messages;
    return { messages };
  }

  const url = new URL(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.listMessages}`);
  if (afterTimestamp) url.searchParams.set("after", afterTimestamp);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${state.authToken}` },
  });
  if (!res.ok) throw new Error("Failed to load messages.");
  return res.json();
}

/* ==========================================================
   VIEW: EMAIL VERIFICATION
   ========================================================== */

els.formRequestOtp.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = els.emailInput.value.trim();

  if (!isValidEmail(email)) {
    setFieldState(els.emailInput, els.emailHint, "error", "Enter a valid email address.");
    return;
  }
  setFieldState(els.emailInput, els.emailHint, null, "");

  setButtonLoading(els.btnSendCode, true);
  try {
    await apiSendOtp(email);
    state.email = email;

    els.formRequestOtp.classList.add("auth-form--hidden");
    els.formVerifyOtp.classList.remove("auth-form--hidden");
    els.sentToNotice.innerHTML = `Code sent to <strong>${escapeHtml(email)}</strong>.`;
    advanceStep(2);
    els.otpInput.focus();

    showToast("Verification code sent.", "success");
  } catch (err) {
    setFieldState(els.emailInput, els.emailHint, "error", err.message);
  } finally {
    setButtonLoading(els.btnSendCode, false);
  }
});

els.formVerifyOtp.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = els.otpInput.value.trim();

  if (!/^\d{6}$/.test(code)) {
    setFieldState(els.otpInput, els.otpHint, "error", "Enter the 6-digit code.");
    return;
  }
  setFieldState(els.otpInput, els.otpHint, null, "");

  setButtonLoading(els.btnVerify, true);
  try {
    const result = await apiVerifyOtp(state.email, code);
    if (!result.ok) {
      setFieldState(els.otpInput, els.otpHint, "error", result.message);
      return;
    }
    state.authToken = result.token || null;
    setFieldState(els.otpInput, els.otpHint, "success", "Verified.");
    showToast("Email verified.", "success");
    setTimeout(goToFeedView, 350);
  } catch (err) {
    setFieldState(els.otpInput, els.otpHint, "error", err.message);
  } finally {
    setButtonLoading(els.btnVerify, false);
  }
});

els.btnResend.addEventListener("click", async () => {
  setButtonLoading(els.btnResend, true);
  try {
    await apiSendOtp(state.email);
    showToast("Code resent.", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setButtonLoading(els.btnResend, false);
  }
});

function advanceStep(stepNumber) {
  const items = els.steps.querySelectorAll(".steps__item");
  items.forEach((item) => {
    const step = Number(item.dataset.step);
    item.classList.toggle("steps__item--current", step === stepNumber);
    item.classList.toggle("steps__item--done", step < stepNumber);
  });
}

/* ==========================================================
   VIEW TRANSITION
   ========================================================== */

function goToFeedView() {
  els.viewVerify.classList.remove("view--active");
  els.viewFeed.classList.add("view--active");
  els.verifiedEmailLabel.textContent = state.email;

  renderMessages(mockBackend.messages.length ? mockBackend.messages : []);
  loadInitialMessages();
  startPolling();
}

/* ==========================================================
   VIEW: MESSAGING / FEED
   ========================================================== */

els.messageBody.addEventListener("input", () => {
  const remaining = 500 - els.messageBody.value.length;
  els.charCount.textContent = `${remaining} left`;
});

els.formPostMessage.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = els.messageName.value.trim();
  const message = els.messageBody.value.trim();

  if (!name || !message) return;

  setButtonLoading(els.btnPost, true);
  try {
    const result = await apiPostMessage(name, message);
    appendMessage(result.message);
    state.lastMessageTimestamp = result.message.timestamp;
    els.formPostMessage.reset();
    els.charCount.textContent = "500 left";
    showToast("Message posted.", "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setButtonLoading(els.btnPost, false);
  }
});

function renderMessages(messages) {
  els.feedList.innerHTML = "";
  if (!messages.length) {
    els.feedList.appendChild(els.feedEmpty);
    return;
  }
  messages
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((m) => appendMessage(m, { animate: false }));
  state.lastMessageTimestamp = messages[messages.length - 1].timestamp;
}

function appendMessage(m, { animate = true } = {}) {
  if (els.feedEmpty.isConnected) els.feedEmpty.remove();

  const card = document.createElement("article");
  card.className = "message-card";
  if (!animate) card.style.animation = "none";

  card.innerHTML = `
    <div class="message-card__top">
      <span class="message-card__name">${escapeHtml(m.name)}</span>
      <span class="message-card__time">${formatTimestamp(new Date(m.timestamp))}</span>
    </div>
    <div class="message-card__body">${escapeHtml(m.message)}</div>
  `;
  els.feedList.appendChild(card);
  els.feedList.scrollTop = els.feedList.scrollHeight;
}

async function loadInitialMessages() {
  try {
    const { messages } = await apiListMessages();
    renderMessages(messages);
  } catch (err) {
    showToast("Couldn't load messages.", "error");
  }
}

/* Polling: swap this for a WebSocket subscription if your backend
   supports one — call appendMessage() from the socket's onmessage
   handler instead of on a timer. */
function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const { messages } = await apiListMessages(state.lastMessageTimestamp);
      if (messages && messages.length) {
        messages
          .sort((a, b) => a.timestamp - b.timestamp)
          .forEach((m) => appendMessage(m));
        state.lastMessageTimestamp = messages[messages.length - 1].timestamp;
      }
      flashLiveIndicator();
    } catch {
      // silent: a single missed poll shouldn't interrupt the user
    }
  }, CONFIG.POLL_INTERVAL_MS);
}

function flashLiveIndicator() {
  els.liveIndicator.style.opacity = "0.5";
  setTimeout(() => (els.liveIndicator.style.opacity = "1"), 150);
}
