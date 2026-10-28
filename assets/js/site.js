(function () {
	'use strict';

	/* ---------------- tabs (hash-addressable, arrow-key navigation) ---------------- */
	var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
	var indicator = document.querySelector('.tab-indicator');
	var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function moveIndicator() {
		var selected = document.querySelector('.tabs [role="tab"][aria-selected="true"]');
		if (!indicator || !selected) return;
		indicator.style.width = selected.offsetWidth + 'px';
		indicator.style.transform = 'translateX(' + selected.offsetLeft + 'px)';
	}

	// Counts the About KPIs up from zero each time the tab is shown.
	function countUp() {
		document.querySelectorAll('[data-count]').forEach(function (el) {
			var end = +el.getAttribute('data-count'), suffix = el.getAttribute('data-suffix') || '';
			if (reducedMotion) { el.textContent = end + suffix; return; }
			var start = performance.now(), dur = 1100;
			(function step(now) {
				var t = Math.min(1, (now - start) / dur);
				el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3))) + suffix;
				if (t < 1) requestAnimationFrame(step);
			})(start);
		});
	}

	function open(name, focus) {
		var target = document.getElementById('tab-' + name);
		if (!target) return;
		tabs.forEach(function (t) {
			var selected = t === target;
			t.setAttribute('aria-selected', selected);
			t.tabIndex = selected ? 0 : -1;
			document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
		});
		moveIndicator();
		if (name === 'about') countUp();
		// Sections now fill the page, so a switch starts the new one from the top.
		if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
		if (focus) target.focus();
		target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		if (history.replaceState) history.replaceState(null, '', '#' + name);
	}

	tabs.forEach(function (t, i) {
		t.addEventListener('click', function () { open(t.id.slice(4)); });
		t.addEventListener('keydown', function (e) {
			var dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
			if (!dir) return;
			e.preventDefault();
			open(tabs[(i + dir + tabs.length) % tabs.length].id.slice(4), true);
		});
	});

	var initial = location.hash.slice(1);
	if (initial && document.getElementById('tab-' + initial)) open(initial);
	else countUp();

	moveIndicator();
	setTimeout(function () { if (indicator) indicator.parentNode.classList.add('is-ready'); }, 50);
	window.addEventListener('resize', moveIndicator);
	// Tab widths change once the web fonts load.
	if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);

	document.querySelectorAll('[data-goto]').forEach(function (btn) {
		btn.addEventListener('click', function () { open(btn.getAttribute('data-goto')); });
	});

	window.portfolioTabs = { open: open };

	/* ---------------- Experience: one role at a time, so the section fits one screen ---------------- */
	var roles = Array.prototype.slice.call(document.querySelectorAll('.xp-list [role="tab"]'));
	function selectRole(target, focus) {
		roles.forEach(function (r) {
			var selected = r === target;
			r.setAttribute('aria-selected', selected);
			r.tabIndex = selected ? 0 : -1;
			document.getElementById(r.getAttribute('aria-controls')).hidden = !selected;
		});
		if (focus) target.focus();
	}
	roles.forEach(function (r, i) {
		r.addEventListener('click', function () { selectRole(r); });
		r.addEventListener('keydown', function (e) {
			var dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
			if (!dir) return;
			e.preventDefault();
			selectRole(roles[(i + dir + roles.length) % roles.length], true);
		});
	});

	/* ---------------- lightbox ---------------- */
	var box = document.getElementById('lightbox');
	if (box && box.showModal) {
		document.querySelectorAll('[data-full]').forEach(function (btn) {
			btn.addEventListener('click', function () {
				box.querySelector('img').src = btn.getAttribute('data-full');
				var caption = btn.querySelector('span'), label = caption.querySelector('em');
				box.querySelector('p').textContent = label
					? label.textContent + ' · ' + caption.textContent.slice(label.textContent.length)
					: caption.textContent;
				box.showModal();
			});
		});
		box.addEventListener('click', function (e) { if (e.target === box) box.close(); });
	}

	/* ---------------- elephant greeter + chat panel (reacts to rag.js events) ---------------- */
	var mascot = document.getElementById('mascot');
	var panel = document.getElementById('assistant');
	if (mascot && panel) {
		var bubble = document.getElementById('mascot-bubble');
		var mascotBtn = document.getElementById('mascot-btn');
		var input = document.getElementById('rag-input');
		var happyTimer = null;

		function setPanel(open) {
			panel.classList.toggle('is-open', open);
			panel.inert = !open;
			panel.setAttribute('aria-hidden', !open);
			mascotBtn.setAttribute('aria-expanded', open);
			if (open) {
				bubble.hidden = true;
				input.focus({ preventScroll: true });
			}
		}

		mascotBtn.addEventListener('click', function () {
			var open = !panel.classList.contains('is-open');
			setPanel(open);
			if (!open) mascotBtn.focus();
		});
		document.getElementById('assistant-close').addEventListener('click', function () {
			setPanel(false);
			mascotBtn.focus();
		});
		document.getElementById('bubble-close').addEventListener('click', function () { bubble.hidden = true; });
		document.querySelectorAll('[data-open-chat]').forEach(function (btn) {
			btn.addEventListener('click', function () { setPanel(true); });
		});

		/* Message Rohit: builds a mailto: or sms: link so the viewer's own app sends it. */
		var compose = document.getElementById('compose');
		var note = document.getElementById('msg-note');
		var CONTACT = { email: 'n.rangarohit@gmail.com', phone: '+19785697460' };

		function setCompose(on) {
			panel.classList.toggle('is-composing', on);
			compose.hidden = !on;
			note.textContent = '';
			(on ? document.getElementById('msg-text') : input).focus({ preventScroll: true });
		}

		function openCompose() {
			if (!panel.classList.contains('is-open')) setPanel(true);
			setCompose(true);
		}

		document.getElementById('msg-open').addEventListener('click', openCompose);
		// The bubble's textbox hands its question to the main chat form, which opens the panel (rag:query).
		document.getElementById('bubble-ask').addEventListener('submit', function (e) {
			e.preventDefault();
			var bubbleInput = document.getElementById('bubble-input');
			var q = bubbleInput.value.trim();
			if (!q) {
				setPanel(true);
				return;
			}
			bubbleInput.value = '';
			input.value = q;
			var form = document.getElementById('rag-form');
			form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'));
		});
		document.getElementById('msg-back').addEventListener('click', function () { setCompose(false); });

		compose.addEventListener('submit', function (e) {
			e.preventDefault();
			var via = e.submitter ? e.submitter.getAttribute('data-via') : 'email';
			var name = document.getElementById('msg-name').value.trim();
			var from = document.getElementById('msg-from').value.trim();
			var text = document.getElementById('msg-text').value.trim();
			if (!text) {
				note.classList.add('is-error');
				note.textContent = 'Please write a message first.';
				return;
			}
			var sign = name || from ? '\n\n— ' + [name, from].filter(Boolean).join(', ') : '';
			var body = encodeURIComponent(text + sign);
			var subject = encodeURIComponent('Portfolio message' + (name ? ' from ' + name : ''));
			// "?&body=" is understood by both iOS and Android messaging apps.
			location.href = via === 'sms'
				? 'sms:' + CONTACT.phone + '?&body=' + body
				: 'mailto:' + CONTACT.email + '?subject=' + subject + '&body=' + body;
			note.classList.remove('is-error');
			note.textContent = via === 'sms'
				? 'Your texting app should open with the message ready to send.'
				: 'Your email app should open with the message ready to send.';
		});
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && panel.classList.contains('is-open')) {
				setPanel(false);
				mascotBtn.focus();
			}
		});

		document.addEventListener('rag:query', function () {
			// Questions from the bubble open the panel so the answer is visible.
			if (!panel.classList.contains('is-open')) setPanel(true);
			if (panel.classList.contains('is-composing')) setCompose(false);
			clearTimeout(happyTimer);
			mascot.classList.remove('is-happy');
			mascot.classList.add('is-thinking');
		});
		document.addEventListener('rag:answer', function () {
			mascot.classList.remove('is-thinking');
			mascot.classList.add('is-happy');
			happyTimer = setTimeout(function () { mascot.classList.remove('is-happy'); }, 1200);
		});
	}

	/* ---------------- auto-grow question box ---------------- */
	var ta = document.getElementById('rag-input');
	if (ta) {
		ta.addEventListener('input', function () {
			ta.style.height = 'auto';
			ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
		});
	}
})();
