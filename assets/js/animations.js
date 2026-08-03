(function () {
	'use strict';

	var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/* ---------------------------------------------------------------------
	   Network canvas — a drifting data-pipeline / neural-net constellation.
	   One instance per section, each paused via IntersectionObserver while
	   its section is off-screen (7 sections would otherwise all animate at
	   once, which is wasted GPU/CPU work for the ones not visible).
	--------------------------------------------------------------------- */
	function createNetworkAnimation(canvas, container) {
		var ctx = canvas.getContext('2d');
		var nodes = [];
		var nodeCount, width, height, dpr;
		var raf = null;
		var running = false;

		function resize() {
			width = container.offsetWidth;
			height = container.offsetHeight;
			dpr = window.devicePixelRatio || 1;
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			canvas.style.width = width + 'px';
			canvas.style.height = height + 'px';
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

			nodeCount = Math.max(14, Math.min(46, Math.round((width * height) / 30000)));
			nodes = [];
			for (var i = 0; i < nodeCount; i++) {
				nodes.push({
					x: Math.random() * width,
					y: Math.random() * height,
					vx: (Math.random() - 0.5) * 0.28,
					vy: (Math.random() - 0.5) * 0.28,
					r: 1.4 + Math.random() * 1.6,
					pulse: Math.random() * Math.PI * 2,
				});
			}
		}

		var LINK_DIST = 150;

		function draw() {
			ctx.clearRect(0, 0, width, height);

			for (var i = 0; i < nodes.length; i++) {
				var n = nodes[i];
				n.x += n.vx;
				n.y += n.vy;
				n.pulse += 0.02;

				if (n.x < 0 || n.x > width) n.vx *= -1;
				if (n.y < 0 || n.y > height) n.vy *= -1;
				n.x = Math.max(0, Math.min(width, n.x));
				n.y = Math.max(0, Math.min(height, n.y));
			}

			// connections
			for (var a = 0; a < nodes.length; a++) {
				for (var b = a + 1; b < nodes.length; b++) {
					var dx = nodes[a].x - nodes[b].x;
					var dy = nodes[a].y - nodes[b].y;
					var dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < LINK_DIST) {
						var alpha = (1 - dist / LINK_DIST) * 0.35;
						ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
						ctx.lineWidth = 1;
						ctx.beginPath();
						ctx.moveTo(nodes[a].x, nodes[a].y);
						ctx.lineTo(nodes[b].x, nodes[b].y);
						ctx.stroke();
					}
				}
			}

			// nodes
			for (var j = 0; j < nodes.length; j++) {
				var node = nodes[j];
				var glow = 0.55 + Math.sin(node.pulse) * 0.35;
				ctx.beginPath();
				ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(255,255,255,' + glow.toFixed(3) + ')';
				ctx.fill();
			}
		}

		function step() {
			if (!running) return;
			draw();
			raf = requestAnimationFrame(step);
		}

		function start() {
			if (running || reducedMotion) return;
			running = true;
			raf = requestAnimationFrame(step);
		}

		function stop() {
			running = false;
			if (raf) cancelAnimationFrame(raf);
		}

		resize();
		window.addEventListener('resize', resize);

		if (reducedMotion) {
			draw();
			return;
		}

		// Start immediately — correctness must not depend on IntersectionObserver
		// firing. Once running, use it purely as a perf optimization to pause
		// sections that are off-screen (with 7 canvases on the page).
		start();

		if ('IntersectionObserver' in window) {
			var io = new IntersectionObserver(
				function (entries) {
					entries.forEach(function (entry) {
						if (entry.isIntersecting) start(); else stop();
					});
				},
				{ threshold: 0.05 }
			);
			io.observe(container);
		}
	}

	function initNetworkCanvases() {
		var canvases = document.querySelectorAll('[data-network]');
		canvases.forEach(function (canvas) {
			var container = canvas.closest('section, footer') || canvas.parentElement;
			createNetworkAnimation(canvas, container);
		});
	}

	/* ---------------------------------------------------------------------
	   Hero typewriter — cycles through role taglines
	--------------------------------------------------------------------- */
	function initTypewriter() {
		var el = document.getElementById('typewriter');
		if (!el) return;

		var phrases = [
			'Data Engineer',
			'Data Scientist',
			'ML Pipeline Architect',
			'AI-Driven Problem Solver',
		];

		if (reducedMotion) {
			el.textContent = phrases[0];
			return;
		}

		var phraseIndex = 0;
		var charIndex = 0;
		var deleting = false;
		var TYPE_MS = 65;
		var DELETE_MS = 35;
		var HOLD_MS = 1400;
		var GAP_MS = 400;

		function tick() {
			var current = phrases[phraseIndex];

			if (!deleting) {
				charIndex++;
				el.textContent = current.slice(0, charIndex);
				if (charIndex === current.length) {
					deleting = true;
					setTimeout(tick, HOLD_MS);
					return;
				}
				setTimeout(tick, TYPE_MS);
			} else {
				charIndex--;
				el.textContent = current.slice(0, charIndex);
				if (charIndex === 0) {
					deleting = false;
					phraseIndex = (phraseIndex + 1) % phrases.length;
					setTimeout(tick, GAP_MS);
					return;
				}
				setTimeout(tick, DELETE_MS);
			}
		}

		tick();
	}

	/* ---------------------------------------------------------------------
	   Scroll reveal — fade + rise as sections/cards enter the viewport
	--------------------------------------------------------------------- */
	function initScrollReveal() {
		var selectors = [
			'#one .row > div',
			'#three .work-card',
			'#four .work-card',
			'#five .row > div',
			'#six .row > div, #six > .container > div',
			'header.major',
		];

		var targets = document.querySelectorAll(selectors.join(', '));
		if (!targets.length) return;

		targets.forEach(function (el, i) {
			el.classList.add('reveal');
			el.style.transitionDelay = Math.min(i % 6, 5) * 70 + 'ms';
		});

		if (reducedMotion || !('IntersectionObserver' in window)) {
			targets.forEach(function (el) { el.classList.add('reveal-active'); });
			return;
		}

		function isInViewport(el) {
			var rect = el.getBoundingClientRect();
			return rect.top < window.innerHeight && rect.bottom > 0;
		}

		// Reveal what's already on screen immediately — don't wait on an async
		// callback to show above-the-fold content.
		var pending = [];
		targets.forEach(function (el) {
			if (isInViewport(el)) el.classList.add('reveal-active');
			else pending.push(el);
		});

		if (!pending.length) return;

		var observer = new IntersectionObserver(
			function (entries) {
				entries.forEach(function (entry) {
					if (entry.isIntersecting) {
						entry.target.classList.add('reveal-active');
						observer.unobserve(entry.target);
					}
				});
			},
			{ threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
		);

		pending.forEach(function (el) { observer.observe(el); });

		// Safety net: if IntersectionObserver never fires for some reason,
		// content must not stay permanently invisible.
		setTimeout(function () {
			pending.forEach(function (el) { el.classList.add('reveal-active'); });
			observer.disconnect();
		}, 4000);
	}

	document.addEventListener('DOMContentLoaded', function () {
		initNetworkCanvases();
		initTypewriter();
		initScrollReveal();
	});
})();
