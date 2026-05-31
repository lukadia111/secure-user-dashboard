const state = { user: null, challenge: null };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function message(target, text, isError = false) {
  const node = $(target);
  node.textContent = text || '';
  node.classList.toggle('error', isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showAuthTab(tab) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $$('.auth-form').forEach((form) => form.classList.add('hidden'));
  if (tab === 'login') $('#loginForm').classList.remove('hidden');
  if (tab === 'register') $('#registerForm').classList.remove('hidden');
  if (tab === 'reset') $('#forgotForm').classList.remove('hidden');
}

function showDashboardPage(view) {
  $$('.nav').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.page').forEach((page) => page.classList.add('hidden'));
  $(`#${view}Page`).classList.remove('hidden');
  if (view === 'admin') loadUsers();
}

function renderUser() {
  const user = state.user;
  $('#authView').classList.add('hidden');
  $('#dashboardView').classList.remove('hidden');
  $('#welcomeTitle').textContent = `Welcome, ${user.name}`;
  $('#welcomeSubtitle').textContent = user.email;
  $('#roleBadge').textContent = user.role;
  $('#verifiedStatus').textContent = user.verified ? 'Email verified' : 'Verification pending';
  $('#metricRole').textContent = user.role;
  $('#metricEmail').textContent = user.email;
  $('#metric2fa').textContent = user.twoFactorEnabled ? 'Enabled' : 'Disabled';
  $('#adminNav').classList.toggle('hidden', user.role !== 'admin');
  $('#profileForm').elements.name.value = user.name;
  $('#profileForm').elements.email.value = user.email;
  $('#twoFactorToggle').checked = user.twoFactorEnabled;
  loadActivity();
}

async function loadMe() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    renderUser();
  } catch {
    $('#authView').classList.remove('hidden');
    $('#dashboardView').classList.add('hidden');
  }
}

async function loadActivity() {
  const { activities } = await api('/api/activity');
  $('#activityList').replaceChildren(...activities.map((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.action} - ${new Date(item.created_at).toLocaleString()}`;
    return li;
  }));
}

async function loadUsers() {
  const { users } = await api('/api/admin/users');
  $('#usersTable').replaceChildren(...users.map((user) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input value="${escapeAttr(user.name)}" data-field="name"></td>
      <td><input value="${escapeAttr(user.email)}" data-field="email"></td>
      <td><select data-field="role"><option value="user">user</option><option value="admin">admin</option></select></td>
      <td><input type="checkbox" data-field="verified"></td>
      <td class="actions"><button data-action="save">Save</button><button data-action="delete">Delete</button></td>
    `;
    tr.querySelector('[data-field="role"]').value = user.role;
    tr.querySelector('[data-field="verified"]').checked = user.verified;
    tr.querySelector('[data-action="save"]').addEventListener('click', () => saveUser(user.id, tr));
    tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteUser(user.id));
    return tr;
  }));
}

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function saveUser(id, row) {
  try {
    await api(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: row.querySelector('[data-field="name"]').value,
        email: row.querySelector('[data-field="email"]').value,
        role: row.querySelector('[data-field="role"]').value,
        verified: row.querySelector('[data-field="verified"]').checked
      })
    });
    message('#dashboardMessage', 'User saved.');
    loadUsers();
  } catch (error) {
    message('#dashboardMessage', error.message, true);
  }
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    message('#dashboardMessage', 'User deleted.');
    loadUsers();
  } catch (error) {
    message('#dashboardMessage', error.message, true);
  }
}

$$('.tab').forEach((button) => button.addEventListener('click', () => showAuthTab(button.dataset.tab)));
$$('.nav').forEach((button) => button.addEventListener('click', () => showDashboardPage(button.dataset.view)));

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) });
    if (data.needsTwoFactor) {
      state.challenge = data.challenge;
      $('#loginForm').classList.add('hidden');
      $('#twoFactorForm').classList.remove('hidden');
      return message('#authMessage', data.message);
    }
    state.user = data.user;
    renderUser();
  } catch (error) {
    message('#authMessage', error.message, true);
  }
});

$('#twoFactorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/2fa', {
      method: 'POST',
      body: JSON.stringify({ challenge: state.challenge, code: event.currentTarget.elements.code.value })
    });
    state.user = data.user;
    renderUser();
  } catch (error) {
    message('#authMessage', error.message, true);
  }
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) });
    message('#authMessage', data.message);
    event.currentTarget.reset();
    showAuthTab('login');
  } catch (error) {
    message('#authMessage', error.message, true);
  }
});

$('#forgotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) });
    message('#authMessage', data.message);
    $('#forgotForm').classList.add('hidden');
    $('#resetForm').classList.remove('hidden');
  } catch (error) {
    message('#authMessage', error.message, true);
  }
});

$('#resetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) });
    message('#authMessage', data.message);
    event.currentTarget.reset();
    showAuthTab('login');
  } catch (error) {
    message('#authMessage', error.message, true);
  }
});

$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/me', { method: 'PATCH', body: JSON.stringify(formData(event.currentTarget)) });
    state.user = data.user;
    renderUser();
    message('#dashboardMessage', data.message);
  } catch (error) {
    message('#dashboardMessage', error.message, true);
  }
});

$('#passwordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/me/password', { method: 'PATCH', body: JSON.stringify(formData(event.currentTarget)) });
    message('#dashboardMessage', data.message);
    event.currentTarget.reset();
  } catch (error) {
    message('#dashboardMessage', error.message, true);
  }
});

$('#twoFactorToggle').addEventListener('change', async (event) => {
  try {
    const data = await api('/api/me/settings', {
      method: 'PATCH',
      body: JSON.stringify({ twoFactorEnabled: event.currentTarget.checked })
    });
    state.user = data.user;
    renderUser();
  } catch (error) {
    message('#dashboardMessage', error.message, true);
  }
});

$('#logoutButton').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  location.reload();
});

const params = new URLSearchParams(location.search);
if (params.has('reset')) {
  showAuthTab('reset');
  $('#forgotForm').classList.add('hidden');
  $('#resetForm').classList.remove('hidden');
  $('#resetForm').elements.token.value = params.get('reset');
}
if (params.has('verified')) message('#authMessage', 'Email verified. You can log in now.');

loadMe();
