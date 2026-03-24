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

  // ─── Wire up register buttons via data attributes ────────────────────────────

  document.querySelectorAll('.js-register-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const opId      = btn.getAttribute('data-op-id');
      const opCode    = btn.getAttribute('data-op-codename');
      const opTitle   = btn.getAttribute('data-op-title');
      let   roles     = [];
      try { roles = JSON.parse(btn.getAttribute('data-op-roles')); } catch (e) {}
      openRegistration(opId, opCode, opTitle, roles);
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

    const roleIcons = {
      'flight lead': '👑',
      'wingman':     '✈️',
      'sead':        '🎯',
      'dead':        '💣',
      'cas':         '🔫',
      'cap':         '🛡️',
      'escort':      '🛡️',
      'strike':      '💥',
      'anti-ship':   '🚢',
      'awacs':       '📡',
      'tanker':      '⛽',
      'jtac':        '📻',
      'reserve':     '🔄',
      'any':         '🔄',
      'ground':      '🗺️',
    };

    roles.forEach(function (role) {
      const key      = role.name.toLowerCase();
      const iconKey  = Object.keys(roleIcons).find(function (k) { return key.includes(k); });
      const icon     = iconKey ? roleIcons[iconKey] : '🪂';
      const isFull   = role.filled >= role.slots;
      const available = role.slots - role.filled;

      const div = document.createElement('div');
      div.className = 'role-option' + (isFull ? ' disabled' : '');

      const radioId = 'role-' + role.name.replace(/\s+/g, '-').toLowerCase();

      div.innerHTML =
        '<input type="radio" name="role_choice" id="' + radioId + '" value="' + escHtml(role.name) + '"' +
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
            // Auto-set aircraft if possible
            const acSelect = document.getElementById('reg-aircraft');
            if (acSelect && role.aircraft && role.aircraft !== 'Various' && role.aircraft !== 'Ground') {
              // Try to match option
              for (let i = 0; i < acSelect.options.length; i++) {
                if (acSelect.options[i].text.toLowerCase().includes(role.aircraft.toLowerCase().split(' ')[0])) {
                  acSelect.selectedIndex = i;
                  break;
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

      const data = {
        operation_id:   document.getElementById('reg-op-id').value,
        operation_name: document.getElementById('reg-op-name').value,
        discord:        document.getElementById('reg-discord').value.trim(),
        callsign:       document.getElementById('reg-callsign').value.trim(),
        role:           regRoleInput.value,
        aircraft:       document.getElementById('reg-aircraft').value,
        experience:     document.getElementById('reg-exp').value,
        notes:          document.getElementById('reg-notes').value.trim(),
        notify:         document.getElementById('reg-notify').checked,
        timestamp:      new Date().toISOString(),
      };

      if (DISCORD_WEBHOOK) {
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

    fetch(DISCORD_WEBHOOK, {
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
