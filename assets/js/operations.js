/**
 * Blue Horizon Squadron — Operations Registration JS
 *
 * Handles:
 *  - Operation filter buttons
 *  - Registration modal open/close
 *  - Role selector population
 *  - Form validation
 *  - Discord webhook submission (or fallback)
 */

(function () {
  'use strict';

  // ─── Config ──────────────────────────────────────────────────────────────────
  // Discord webhook URL is injected via a data attribute on <body> or window variable.
  // Set site.squadron.discord_webhook in _config.yml to enable direct posting.
  const DISCORD_WEBHOOK = (typeof window.BHS_DISCORD_WEBHOOK !== 'undefined')
    ? window.BHS_DISCORD_WEBHOOK
    : '';

  // Registration backend (Cloudflare Worker recommended)
  const cfgEl = document.getElementById('bhs-config');
  const REG_ENDPOINT = cfgEl ? (cfgEl.getAttribute('data-registration-endpoint') || '') : '';
  const REG_SHARED_SECRET = cfgEl ? (cfgEl.getAttribute('data-registration-shared-secret') || '') : '';
  const DISCORD_WEBHOOK_FROM_CFG = cfgEl ? (cfgEl.getAttribute('data-discord-webhook') || '') : '';
  const EFFECTIVE_DISCORD_WEBHOOK = DISCORD_WEBHOOK_FROM_CFG || DISCORD_WEBHOOK || '';

  // Derive ops-status endpoint from registration endpoint
  const OPS_STATUS_ENDPOINT = (function () {
    if (!REG_ENDPOINT) return '';
    try {
      const u = new URL(REG_ENDPOINT);
      u.pathname = '/ops-status';
      u.search = '';
      return u.toString();
    } catch {
      return '';
    }
  })();

  function roleKeyOf(role) {
    return String(role?.name || '') + '|' + String(role?.aircraft || '');
  }

  function mergeLiveRoleStatus(roles, liveRoles) {
    if (!Array.isArray(roles) || !liveRoles) return roles;
    return roles.map(function (r) {
      const rk = roleKeyOf(r);
      const live = liveRoles[rk];
      if (!live) return r;
      return {
        ...r,
        slots: typeof live.slots === 'number' ? live.slots : r.slots,
        filled: typeof live.filled === 'number' ? live.filled : r.filled,
      };
    });
  }

  async function fetchOpStatus(operationId) {
    if (!OPS_STATUS_ENDPOINT || !operationId) return null;

    // Pass role keys so backend can initialize trusted role slot totals even before any regs exist
    let roleKeys = [];
    try {
      const card = document.getElementById(operationId);
      if (card) {
        roleKeys = Array.from(card.querySelectorAll('[data-role-key]'))
          .map(function (el) { return el.getAttribute('data-role-key') || ''; })
          .map(function (s) { return String(s).trim(); })
          .filter(Boolean);
      }
    } catch (e) {
      roleKeys = [];
    }

    const url = (function () {
      const base = OPS_STATUS_ENDPOINT + '?operation_id=' + encodeURIComponent(operationId);
      if (!roleKeys.length) return base;
      // Comma-separated; server also accepts JSON but comma keeps URL smaller
      return base + '&role_keys=' + encodeURIComponent(roleKeys.join(','));
    })();

    const res = await fetch(url, { method: 'GET' });
    const json = await res.json().catch(function () { return null; });
    if (!res.ok) return null;
    return json;
  }

  function updateOpCardUI(opId, liveRoles, liveTotals) {
    const card = document.getElementById(opId);
    if (!card) return;

    // Update role tiles
    if (liveRoles) {
      const roleTiles = card.querySelectorAll('[data-role-key]');
      if (roleTiles && roleTiles.length) {
        roleTiles.forEach(function (tile) {
          const rk = tile.getAttribute('data-role-key');
          const live = liveRoles[rk];
          if (!live) return;

          const statusEl = tile.querySelector('[data-role-status]');
          if (!statusEl) return;

          const open = Number(live.slots || 0) - Number(live.filled || 0);
          const isFull = open <= 0;

          tile.style.borderColor = isFull ? 'rgba(215,58,73,.4)' : '#30363d';
          const titleEl = tile.querySelector('div');
          if (titleEl) titleEl.style.color = isFull ? '#d73a49' : '#f0f6fc';
          statusEl.style.color = isFull ? '#d73a49' : '#2d9cdb';

          if (isFull) {
            statusEl.textContent = `🔴 FULL (${live.filled}/${live.slots})`;
            statusEl.setAttribute('data-role-full', 'true');
          } else {
            statusEl.textContent = `🟢 ${open} slot${open !== 1 ? 's' : ''} open`;
            statusEl.setAttribute('data-role-full', 'false');
          }
        });
      }
    }

    // Overall slots bar/label/text (prefer live totals)
    const slotsWrap = card.querySelector('.op-card__slots[data-op-id]');
    const total = Number(liveTotals?.slots_total ?? (slotsWrap ? slotsWrap.getAttribute('data-op-slots-total') : 0));
    const filled = Number(liveTotals?.slots_filled ?? (slotsWrap ? slotsWrap.getAttribute('data-op-slots-filled') : 0));

    if (slotsWrap && Number.isFinite(total) && total > 0 && Number.isFinite(filled)) {
      slotsWrap.setAttribute('data-op-slots-total', String(total));
      slotsWrap.setAttribute('data-op-slots-filled', String(filled));

      const pct = Math.max(0, Math.min(100, (filled * 100) / total));

      const fillEl = slotsWrap.querySelector('.op-card__slots-fill');
      if (fillEl) {
        fillEl.style.width = `${pct}%`;
        fillEl.setAttribute('data-op-slots-pct', String(pct));
      }

      const labelEl = slotsWrap.querySelector('.op-card__slots-label');
      if (labelEl) labelEl.textContent = `Overall registration (${filled}/${total} pilots)`;

      const remaining = Math.max(0, total - filled);
      const textEl = slotsWrap.querySelector('.op-card__slots-text');
      if (textEl) textEl.textContent = `${remaining} slot${remaining !== 1 ? 's' : ''} remaining`;
    }
  }

  async function refreshOperationStatus(opId) {
    const status = await fetchOpStatus(opId);
    if (!status || !status.ok) return null;
    return { roles: status.roles || null, totals: status.totals || null };
  }

  // ─── Wire up register buttons via data attributes ────────────────────────────

  document.querySelectorAll('.js-register-btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const opId      = btn.getAttribute('data-op-id');
      const opCode    = btn.getAttribute('data-op-codename');
      const opTitle   = btn.getAttribute('data-op-title');
      let   roles     = [];
      try { roles = JSON.parse(btn.getAttribute('data-op-roles')); } catch (e) {}

      // Pull live counts before opening modal
      try {
        const live = await refreshOperationStatus(opId);
        if (live && live.roles) {
          roles = mergeLiveRoleStatus(roles, live.roles);
          // Update card UI too
          updateOpCardUI(opId, live.roles, live.totals);
        }
      } catch (e) {
        // best-effort; ignore
      }

      openRegistration(opId, opCode, opTitle, roles);
    });
  });

  // On initial page load, best-effort refresh for all operation cards
  window.addEventListener('load', function () {
    const buttons = document.querySelectorAll('.js-register-btn');
    buttons.forEach(function (btn) {
      const opId = btn.getAttribute('data-op-id');
      if (!opId) return;

      refreshOperationStatus(opId).then(function (live) {
        if (live && live.roles) updateOpCardUI(opId, live.roles, live.totals);
      }).catch(function () { /* ignore */ });
    });
  });

  const filterBtns = document.querySelectorAll('.filter-btn');
  const opCards    = document.querySelectorAll('.op-card');

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');
      opCards.forEach(function (card) {
        if (filter === 'all' || card.getAttribute('data-status') === filter) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  // ─── Modal elements ───────────────────────────────────────────────────────────

  const regModal      = document.getElementById('reg-modal');
  const successModal  = document.getElementById('success-modal');
  const modalClose    = document.getElementById('modal-close');
  const modalCancel   = document.getElementById('modal-cancel');
  const modalSubmit   = document.getElementById('modal-submit');
  const successClose  = document.getElementById('success-close');
  const roleSelector  = document.getElementById('role-selector');
  const regRoleInput  = document.getElementById('reg-role');
  const regRoleKeyInput = (function () {
    // Create hidden input to preserve a stable role key (name|aircraft)
    let el = document.getElementById('reg-role-key');
    if (!el) {
      el = document.createElement('input');
      el.type = 'hidden';
      el.id = 'reg-role-key';
      el.name = 'role_key';
      const form = document.getElementById('reg-form');
      if (form) form.appendChild(el);
    }
    return el;
  })();
  const formError     = document.getElementById('form-error');
  const submitText    = document.getElementById('submit-text');
  const submitLoading = document.getElementById('submit-loading');

  let currentOpId   = '';
  let currentRoles  = [];

  // ─── Open registration modal ─────────────────────────────────────────────────

  function openRegistration(opId, opCodename, opTitle, roles) {
    currentOpId  = opId;
    currentRoles = roles;

    // Set op info in modal header
    document.getElementById('modal-op-codename').textContent = opCodename;
    document.getElementById('modal-op-title').textContent    = opTitle;
    document.getElementById('reg-op-id').value   = opId;
    document.getElementById('reg-op-name').value = opTitle;

    // Build role selector
    buildRoleSelector(roles);

    // Reset form state
    resetForm();

    // Open modal
    regModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Focus first field
    setTimeout(function () {
      const firstInput = document.getElementById('reg-discord');
      if (firstInput) firstInput.focus();
    }, 100);
  };

  function buildRoleSelector(roles) {
    roleSelector.innerHTML = '';
    regRoleInput.value = '';
    if (regRoleKeyInput) regRoleKeyInput.value = '';

    const roleIcons = {
      'flight lead': '👑',
      'intercept':     '✈️',
      'sead':        '🎯',
      'dead':        '💣',
      'cas':         '🔫',
      'cap':         '🛡️',
      'escort':      '✈️',
      'strike':      '💥',
      'anti-ship':   '🚢',
      'awacs':       '📡',
      'tanker':      '⛽',
      'jtac':        '📻',
      'reserve':     '🔄',
      'any':         '🔄',
      'ground':      '🗺️',
    };

    roles.forEach(function (role, idx) {
      const key      = role.name.toLowerCase();
      const iconKey  = Object.keys(roleIcons).find(function (k) { return key.includes(k); });
      const icon     = iconKey ? roleIcons[iconKey] : '🪂';
      const isFull   = role.filled >= role.slots;
      const available = role.slots - role.filled;

      // Stable unique key for this role entry (disambiguates duplicates like "SEAD")
      const roleKey = String(role.name || '') + '|' + String(role.aircraft || '');

      const div = document.createElement('div');
      div.className = 'role-option' + (isFull ? ' disabled' : '');

      const radioId = 'role-' + roleKey.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + idx;

      div.innerHTML =
        '<input type="radio" name="role_choice" id="' + radioId + '" value="' + escHtml(role.name) + '" data-role-key="' + escHtml(roleKey) + '"' +
        (isFull ? ' disabled' : '') + '>' +
        '<label for="' + radioId + '">' +
        '<span class="icon">' + icon + '</span>' +
        '<strong>' + escHtml(role.name) + '</strong>' +
        '<span style="font-size:.75rem; color:' + (isFull ? '#d73a49' : '#28a745') + ';">' +
        (isFull ? '🔴 Full' : '🟢 ' + available + ' open') + '</span>' +
        '<span style="font-size:.72rem; color:#8b949e;">' + escHtml(role.aircraft) + '</span>' +
        '</label>';

      roleSelector.appendChild(div);

      // Listen for selection
      const radio = div.querySelector('input[type="radio"]');
      if (radio) {
        radio.addEventListener('change', function () {
          if (this.checked) {
            regRoleInput.value = this.value;
            if (regRoleKeyInput) regRoleKeyInput.value = this.getAttribute('data-role-key') || '';

            // Auto-set aircraft if possible
            const acSelect = document.getElementById('reg-aircraft');
            if (acSelect && role.aircraft && role.aircraft !== 'Various' && role.aircraft !== 'Ground') {
              // Match exact option text first, then fallback to contains
              const want = String(role.aircraft).trim().toLowerCase();
              let matched = false;
              for (let i = 0; i < acSelect.options.length; i++) {
                if (String(acSelect.options[i].text || '').trim().toLowerCase() === want) {
                  acSelect.selectedIndex = i;
                  matched = true;
                  break;
                }
              }
              if (!matched) {
                for (let i = 0; i < acSelect.options.length; i++) {
                  if (String(acSelect.options[i].text || '').trim().toLowerCase().includes(want)) {
                    acSelect.selectedIndex = i;
                    break;
                  }
                }
              }
            }
          }
        });
      }
    });
  }

  // ─── Close modal ─────────────────────────────────────────────────────────────

  function closeRegModal() {
    regModal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function closeSuccessModal() {
    successModal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  if (modalClose)  modalClose.addEventListener('click', closeRegModal);
  if (modalCancel) modalCancel.addEventListener('click', closeRegModal);
  if (successClose) successClose.addEventListener('click', closeSuccessModal);

  // Click outside to close
  if (regModal) {
    regModal.addEventListener('click', function (e) {
      if (e.target === regModal) closeRegModal();
    });
  }
  if (successModal) {
    successModal.addEventListener('click', function (e) {
      if (e.target === successModal) closeSuccessModal();
    });
  }

  // Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeRegModal();
      closeSuccessModal();
    }
  });

  // ─── Form validation ─────────────────────────────────────────────────────────

  function validateForm() {
    const discord  = document.getElementById('reg-discord').value.trim();
    const callsign = document.getElementById('reg-callsign').value.trim();
    const role     = regRoleInput.value;
    const roleKey  = regRoleKeyInput ? regRoleKeyInput.value : '';
    const aircraft = document.getElementById('reg-aircraft').value;

    if (!discord) {
      showError('Please enter your Discord username.');
      document.getElementById('reg-discord').focus();
      return false;
    }
    if (!callsign) {
      showError('Please enter your callsign / pilot name.');
      document.getElementById('reg-callsign').focus();
      return false;
    }
    if (!role) {
      showError('Please select a role from the list above.');
      return false;
    }

    if (!roleKey) {
      showError('Please select a role from the list above.');
      return false;
    }

    // Hard-stop if the chosen role is full (client-side enforcement)
    // Note: true enforcement must also exist server-side; for a static site this
    // prevents obvious overbooking and blocks stale UI selections.
    if (Array.isArray(currentRoles) && currentRoles.length) {
      const selected = currentRoles.find(function (r) {
        if (!r) return false;
        return (String(r.name || '') + '|' + String(r.aircraft || '')) === roleKey;
      });
      if (selected && typeof selected.slots !== 'undefined' && typeof selected.filled !== 'undefined') {
        if (Number(selected.filled) >= Number(selected.slots)) {
          showError('That role is currently full. Please select another role.');
          // Optionally focus the role grid
          if (roleSelector) roleSelector.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          return false;
        }
      }
    }

    if (!aircraft) {
      showError('Please select your aircraft module.');
      document.getElementById('reg-aircraft').focus();
      return false;
    }
    return true;
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.style.display = 'block';
    formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    formError.style.display = 'none';
    formError.textContent   = '';
  }

  function resetForm() {
    const form = document.getElementById('reg-form');
    if (form) form.reset();
    hideError();
    setSubmitLoading(false);
  }

  function setSubmitLoading(loading) {
    if (!submitText || !submitLoading || !modalSubmit) return;
    submitText.style.display    = loading ? 'none' : '';
    submitLoading.style.display = loading ? ''     : 'none';
    modalSubmit.disabled        = loading;
  }

  // ─── Submit registration ──────────────────────────────────────────────────────

  if (modalSubmit) {
    modalSubmit.addEventListener('click', function () {
      hideError();
      if (!validateForm()) return;

      setSubmitLoading(true);

      const roleKey = regRoleKeyInput ? regRoleKeyInput.value : '';
      const selectedRole = (Array.isArray(currentRoles) && currentRoles.length)
        ? currentRoles.find(function (r) {
            if (!r) return false;
            return (String(r.name || '') + '|' + String(r.aircraft || '')) === roleKey;
          })
        : null;

      const data = {
        operation_id:   document.getElementById('reg-op-id').value,
        operation_name: document.getElementById('reg-op-name').value,
        discord:        document.getElementById('reg-discord').value.trim(),
        callsign:       document.getElementById('reg-callsign').value.trim(),
        role:           regRoleInput.value,
        role_aircraft:  roleKey,
        role_slots:     selectedRole && typeof selectedRole.slots !== 'undefined' ? selectedRole.slots : '',
        aircraft:       document.getElementById('reg-aircraft').value,
        experience:     document.getElementById('reg-exp').value,
        notes:          document.getElementById('reg-notes').value.trim(),
        notify:         document.getElementById('reg-notify').checked,
        timestamp:      new Date().toISOString(),
      };

      // Preferred: send to backend endpoint (does slot enforcement + then notifies)
      if (REG_ENDPOINT) {
        sendToBackend(data);
        return;
      }

      // Fallback: direct Discord webhook
      if (EFFECTIVE_DISCORD_WEBHOOK) {
        sendToDiscord(data);
      } else {
        // No webhook configured — show success after short delay (for demo)
        setTimeout(function () {
          setSubmitLoading(false);
          closeRegModal();
          showSuccess();
        }, 800);
      }
    });
  }

  // ─── Backend submission (Cloudflare Worker) ─────────────────────────────────-

  function sendToBackend(data) {
    const headers = { 'Content-Type': 'application/json' };
    if (REG_SHARED_SECRET) headers['X-BHS-Auth'] = REG_SHARED_SECRET;

    fetch(REG_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    })
    .then(function (res) {
      return res.json().catch(function () {
        return { ok: false, status: res.status, message: 'Invalid server response.' };
      }).then(function (json) {
        json._httpStatus = res.status;
        return json;
      });
    })
    .then(function (json) {
      setSubmitLoading(false);
      if (json && json.ok) {
        closeRegModal();
        showSuccess();
        return;
      }

      // Slot full / validation errors should show message
      const msg = (json && (json.message || json.error))
        ? (json.message || json.error)
        : ('Submission failed.');
      showError(msg);
    })
    .catch(function (err) {
      setSubmitLoading(false);
      console.error('Registration backend error:', err);
      showError('Network error. Please try again later or register via Discord.');
    });
  }

  // ─── Discord Webhook ─────────────────────────────────────────────────────────

  function sendToDiscord(data) {
    const embed = {
      embeds: [{
        title: '📋 New Operation Registration',
        color: 0x2d9cdb,
        fields: [
          { name: '🎯 Operation',       value: data.operation_name,         inline: false },
          { name: '👤 Pilot',           value: data.callsign,                inline: true  },
          { name: '💬 Discord',         value: data.discord,                 inline: true  },
          { name: '🛩 Aircraft',        value: data.aircraft,                inline: true  },
          { name: '🎖 Role',            value: data.role,                    inline: true  },
          { name: '⚡ Experience',      value: data.experience || 'Not specified', inline: true },
          { name: '📝 Notes',           value: data.notes || '—',            inline: false },
          { name: '🔔 Briefing DM',     value: data.notify ? 'Yes' : 'No',  inline: true  },
        ],
        footer: { text: 'Blue Horizon Squadron · ' + data.timestamp },
        thumbnail: {
          url: 'https://github.com/user-attachments/assets/a3c829a6-d9b9-46ea-a03f-931e799a80b7'
        }
      }]
    };

    fetch(EFFECTIVE_DISCORD_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(embed),
    })
    .then(function (res) {
      setSubmitLoading(false);
      if (res.ok || res.status === 204) {
        closeRegModal();
        showSuccess();
      } else {
        showError('Submission failed (HTTP ' + res.status + '). Please try again or register via Discord.');
      }
    })
    .catch(function (err) {
      setSubmitLoading(false);
      console.error('Discord webhook error:', err);
      showError('Network error. Please try again or register via Discord directly.');
    });
  }

  // ─── Success modal ───────────────────────────────────────────────────────────

  function showSuccess() {
    successModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;');
  }

})();
