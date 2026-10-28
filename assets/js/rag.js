/* ---------------------------------------------------------------------
   "Ask about me" — a small retrieval-augmented generation pipeline.

   1. Ingest   knowledge.json is fetched and indexed in the browser
   2. Retrieve query is tokenized, typo-corrected against the vocabulary
               (char-trigram similarity), expanded with synonyms and scored
               with BM25 over every chunk
   3. Rerank   keep the top chunks that score close to the best match
   4. Generate if window.RAG_CONFIG.endpoint is set, the question and the
               retrieved chunk ids go to a Claude-backed worker; otherwise
               an extractive answer is composed from the best sentences
--------------------------------------------------------------------- */
(function () {
	'use strict';

	var CONFIG = window.RAG_CONFIG || {};
	var TOP_K = 3;

	var STOPWORDS = new Set(('a an and are as at be by can could did do does for from had has have he her his how i ' +
		'in into is it its me my of on or our she so tell than that the their them then there these they this ' +
		'to was we were what when which who whom why will with would you your about rohit ranga nallamolu ' +
		'him he she they please know any some much many give list show').split(' '));

	// Query-side expansion: casual words a visitor might use -> terms in the knowledge base.
	var SYNONYMS = {
		ai: ['llm', 'agentic', 'rag', 'langgraph', 'claude'],
		genai: ['llm', 'ai', 'rag'],
		llm: ['ai', 'claude', 'langgraph'],
		job: ['current', 'role', 'experience'],
		work: ['experience', 'role'],
		company: ['employer', 'mckesson', 'bigblue'],
		current: ['present', 'mckesson'],
		now: ['current', 'present'],
		fast: ['optimization', 'performance'],
		speed: ['optimization', 'performance', 'runtime'],
		optimize: ['optimization', 'tuning', 'performance'],
		cost: ['cost', 'cluster'],
		school: ['education', 'university'],
		college: ['education', 'university'],
		degree: ['education', 'masters', 'bachelors'],
		masters: ['master', 'education', 'degree'],
		master: ['masters', 'education', 'degree'],
		ms: ['masters', 'education'],
		bachelors: ['bachelor', 'btech', 'education'],
		graduated: ['graduation', 'completed', 'education'],
		finished: ['completed', 'education'],
		years: ['experience'],
		experience: ['years'],
		hiring: ['available', 'open'],
		looking: ['available', 'open'],
		where: ['location', 'based'],
		study: ['education'],
		studied: ['education'],
		sport: ['badminton', 'cricket'],
		hobby: ['hobbies', 'badminton', 'cricket'],
		fun: ['hobbies', 'cricket'],
		award: ['achievements', 'champion'],
		hire: ['strengths', 'impact'],
		reach: ['contact', 'email'],
		email: ['contact'],
		phone: ['contact'],
		stack: ['skills', 'tools'],
		tech: ['skills', 'tools'],
		tool: ['skills', 'tools'],
		language: ['languages', 'python', 'scala'],
		dashboard: ['dashboards', 'power', 'bi'],
		report: ['reporting', 'dashboards'],
		quality: ['validation', 'reconciliation', 'checks'],
		test: ['testing', 'validation'],
		secure: ['governance', 'security', 'rbac'],
		governance: ['unity', 'catalog', 'rbac'],
		stock: ['stocksense', 'trading'],
		trade: ['stocksense', 'trading'],
		live: ['location', 'based'],
		pipeline: ['pipelines', 'etl'],
		stream: ['streaming', 'kafka', 'real-time'],
		realtime: ['real-time', 'streaming', 'kafka'],
		cert: ['certifications'],
		resume: ['resume', 'contact'],
		cv: ['resume', 'contact']
	};

	/* ---------------- text processing ---------------- */

	function stem(t) {
		if (t.length > 5 && /ing$/.test(t)) t = t.slice(0, -3);
		else if (t.length > 4 && /ies$/.test(t)) t = t.slice(0, -3) + 'y';
		else if (t.length > 4 && /ed$/.test(t)) t = t.slice(0, -2);
		else if (t.length > 3 && /s$/.test(t) && !/ss$/.test(t)) t = t.slice(0, -1);
		// "complete" and "completed" (or "graduate" and "graduated") share one stem.
		if (t.length > 4 && /[^e]e$/.test(t)) t = t.slice(0, -1);
		return t;
	}

	function rawTokens(text) {
		return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.&-]*[a-z0-9+#]|[a-z0-9]/g) || [])
			.filter(function (t) { return !STOPWORDS.has(t); });
	}

	function tokenize(text) {
		return rawTokens(text).map(stem);
	}

	function trigrams(word) {
		var w = '  ' + word + ' ';
		var set = new Set();
		for (var i = 0; i < w.length - 2; i++) set.add(w.slice(i, i + 3));
		return set;
	}

	function jaccard(a, b) {
		var inter = 0;
		a.forEach(function (g) { if (b.has(g)) inter++; });
		return inter / (a.size + b.size - inter);
	}

	function splitSentences(text) {
		// Split only where punctuation is followed by a space and a capital, so "Next.js" stays whole.
		return text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map(function (s) { return s.trim(); }).filter(Boolean);
	}

	/* ---------------- index (BM25) ---------------- */

	function buildIndex(chunks) {
		var docs = chunks.map(function (c) {
			// Title and keywords are repeated so they weigh more than body text.
			var tokens = tokenize(c.title + ' ' + c.title + ' ' + c.keywords + ' ' + c.keywords + ' ' + c.text);
			var tf = new Map();
			tokens.forEach(function (t) { tf.set(t, (tf.get(t) || 0) + 1); });
			return { chunk: c, tf: tf, len: tokens.length };
		});

		var df = new Map();
		docs.forEach(function (d) { d.tf.forEach(function (_, t) { df.set(t, (df.get(t) || 0) + 1); }); });

		var vocab = Array.from(df.keys());
		var vocabGrams = vocab.map(function (v) { return { term: v, grams: trigrams(v) }; });
		var avgLen = docs.reduce(function (s, d) { return s + d.len; }, 0) / docs.length;

		return { docs: docs, df: df, vocab: new Set(vocab), vocabGrams: vocabGrams, avgLen: avgLen, N: docs.length };
	}

	function correct(index, term) {
		if (index.vocab.has(term) || term.length < 4) return null;
		var grams = trigrams(term), best = null, bestScore = 0.45;
		index.vocabGrams.forEach(function (v) {
			var s = jaccard(grams, v.grams);
			if (s > bestScore) { bestScore = s; best = v.term; }
		});
		return best;
	}

	function analyzeQuery(index, question) {
		var raw = rawTokens(question);
		var corrections = [];
		var terms = new Map(); // term -> weight

		function add(t, w) { if (!terms.has(t) || terms.get(t) < w) terms.set(t, w); }

		raw.forEach(function (r) {
			var t = stem(r);
			var fixed = correct(index, t);
			if (fixed) { corrections.push([r, fixed]); t = fixed; }
			add(t, 1);
			(SYNONYMS[r] || SYNONYMS[t] || []).forEach(function (s) { add(stem(s), 0.5); });
		});

		return { terms: terms, corrections: corrections };
	}

	function bm25(index, terms) {
		var k1 = 1.2, b = 0.75;
		return index.docs.map(function (d) {
			var score = 0;
			terms.forEach(function (w, t) {
				var f = d.tf.get(t);
				if (!f) return;
				var n = index.df.get(t);
				var idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
				score += w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avgLen));
			});
			return { chunk: d.chunk, score: score };
		}).sort(function (a, b) { return b.score - a.score; });
	}

	function retrieve(index, question) {
		var q = analyzeQuery(index, question);
		var ranked = bm25(index, q.terms);
		var top = ranked[0] ? ranked[0].score : 0;
		var hits = ranked.filter(function (r, i) {
			// Supporting chunks must be nearly as relevant, or they drown out a direct answer.
			return i < TOP_K && r.score > 0 && r.score >= top * 0.7;
		});
		return { query: q, hits: hits, topScore: top };
	}

	/* ---------------- extractive answer ---------------- */

	function sentenceScore(sentence, terms) {
		var toks = new Set(tokenize(sentence));
		var s = 0;
		terms.forEach(function (w, t) { if (toks.has(t)) s += w; });
		return s;
	}

	function composeAnswer(result) {
		var terms = result.query.terms;
		var parts = [];
		var seen = new Set();

		// Share of a sentence's terms not already said; avoids repeating a fact from another chunk.
		function novelty(sentence) {
			var toks = tokenize(sentence);
			if (!toks.length) return 0;
			return toks.filter(function (t) { return !seen.has(t); }).length / toks.length;
		}

		function take(s) {
			parts.push(s);
			tokenize(s).forEach(function (t) { seen.add(t); });
		}

		result.hits.forEach(function (hit, i) {
			var sentences = splitSentences(hit.chunk.text);
			var scored = sentences.map(function (s, idx) {
				// Earlier sentences carry the topic sentence, so they win ties.
				return { s: s, idx: idx, score: sentenceScore(s, terms) + (sentences.length - idx) * 0.01 };
			});

			if (i === 0) {
				// The best chunk is usually what the visitor asked about: give it room.
				var keep = sentences.length <= 4 ? sentences.length : 3;
				scored.slice().sort(function (a, b) { return b.score - a.score; }).slice(0, keep)
					.sort(function (a, b) { return a.idx - b.idx; })
					.forEach(function (x) { take(x.s); });
				return;
			}

			// Supporting chunks add at most one relevant sentence with something new in it.
			var extra = scored.slice().sort(function (a, b) { return b.score - a.score; })
				.filter(function (x) { return x.score >= 0.5 && novelty(x.s) >= 0.5; })[0];
			if (extra) take(extra.s);
		});

		return parts.join(' ');
	}

	/* ---------------- small talk ---------------- */

	function smallTalk(q) {
		var s = q.trim().toLowerCase();
		if (/^(hi|hello|hey|yo|hola|good (morning|afternoon|evening))\b[!. ]*$/.test(s)) {
			return 'Hi! Ask me anything about Rohit: experience, projects, skills, education, or sports.';
		}
		if (/^(thanks|thank you|thx|cool|great|nice)\b/.test(s)) {
			return 'Happy to help. Anything else you want to know about Rohit?';
		}
		return null;
	}

	var NO_MATCH = 'I could not find that in Rohit\'s profile. Try asking about experience, projects, skills, or education, ' +
		'or email Rohit directly at n.rangarohit@gmail.com.';

	/* ---------------- optional LLM generation ---------------- */

	function generateWithLLM(question, hits) {
		var controller = new AbortController();
		var timer = setTimeout(function () { controller.abort(); }, 15000);
		return fetch(CONFIG.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ question: question, ids: hits.map(function (h) { return h.chunk.id; }) }),
			signal: controller.signal
		}).then(function (res) {
			clearTimeout(timer);
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return res.json();
		}).then(function (data) {
			if (!data || typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('empty answer');
			return data.answer.trim();
		});
	}

	/* ---------------- UI ---------------- */

	var form = document.getElementById('rag-form');
	if (!form) return;

	var input = document.getElementById('rag-input');
	var log = document.getElementById('rag-log');
	var stages = Array.prototype.slice.call(document.querySelectorAll('#rag-stages [data-stage]'));
	var modeLabel = document.getElementById('rag-mode');
	var submitBtn = form.querySelector('button[type="submit"]');
	var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	var index = null;
	var busy = false;

	modeLabel.textContent = CONFIG.endpoint ? 'Generator: Claude' : 'Generator: extractive';

	var ready = fetch('assets/data/knowledge.json', { cache: 'no-cache' })
		.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
		.then(function (kb) {
			index = buildIndex(kb.chunks);
			setStage('ingest', 'done', kb.chunks.length + ' chunks');
		})
		.catch(function () {
			setStage('ingest', 'error', 'offline');
		});

	function setStage(name, state, detail) {
		stages.forEach(function (el) {
			if (el.getAttribute('data-stage') !== name) return;
			el.setAttribute('data-state', state);
			var d = el.querySelector('.stage-detail');
			if (d && detail !== undefined) d.textContent = detail;
		});
	}

	function resetStages() {
		['retrieve', 'rerank', 'generate'].forEach(function (s) { setStage(s, 'idle', ''); });
	}

	function wait(ms) {
		return new Promise(function (r) { setTimeout(r, reducedMotion ? 0 : ms); });
	}

	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text !== undefined) e.textContent = text;
		return e;
	}

	function scrollLog() { log.scrollTop = log.scrollHeight; }

	function typeInto(node, text) {
		if (reducedMotion) { node.textContent = text; return Promise.resolve(); }
		return new Promise(function (resolve) {
			var i = 0;
			(function tick() {
				i = Math.min(text.length, i + 3);
				node.textContent = text.slice(0, i);
				scrollLog();
				if (i < text.length) setTimeout(tick, 12); else resolve();
			})();
		});
	}

	function renderSources(container, hits) {
		if (!hits.length) return;
		var wrap = el('div', 'msg-sources');
		wrap.appendChild(el('span', 'msg-sources-label', 'Sources'));
		var max = hits[0].score || 1;
		hits.forEach(function (h) {
			var btn = el('button', 'source-chip');
			btn.type = 'button';
			btn.title = 'Open the ' + h.chunk.tab + ' tab';
			btn.appendChild(el('span', '', h.chunk.title));
			btn.appendChild(el('span', 'source-score', (h.score / max).toFixed(2)));
			btn.addEventListener('click', function () {
				if (window.portfolioTabs) window.portfolioTabs.open(h.chunk.tab);
			});
			wrap.appendChild(btn);
		});
		container.appendChild(wrap);
	}

	function ask(question) {
		question = question.trim().slice(0, 300);
		if (!question || busy) return;
		busy = true;
		submitBtn.disabled = true;

		var userMsg = el('div', 'msg msg-user');
		userMsg.appendChild(el('p', '', question));
		log.appendChild(userMsg);

		var botMsg = el('div', 'msg msg-bot');
		var body = el('p', 'msg-text');
		body.appendChild(el('span', 'typing-dots', '···'));
		botMsg.appendChild(body);
		log.appendChild(botMsg);
		scrollLog();

		document.dispatchEvent(new CustomEvent('rag:query'));
		resetStages();

		var hits = [];
		var greeting = smallTalk(question);

		ready.then(function () {
			if (greeting) return greeting;
			if (!index) return 'The knowledge base could not be loaded. Please open the page through a web server and try again.';

			setStage('retrieve', 'active');
			return wait(320).then(function () {
				var result = retrieve(index, question);
				var fixes = result.query.corrections.map(function (c) { return c[0] + '→' + c[1]; }).join(', ');
				setStage('retrieve', 'done', result.query.terms.size + ' terms' + (fixes ? ' · ' + fixes : ''));
				setStage('rerank', 'active');
				return wait(280).then(function () {
					hits = result.hits;
					setStage('rerank', 'done', 'top ' + hits.length);
					setStage('generate', 'active');
					if (!hits.length || result.topScore < 1.2) { hits = []; return NO_MATCH; }
					if (!CONFIG.endpoint) return wait(220).then(function () { return composeAnswer(result); });
					return generateWithLLM(question, hits).catch(function () {
						// Network or worker failure: fall back to the in-browser answer.
						return composeAnswer(result);
					});
				});
			});
		}).then(function (answer) {
			setStage('generate', 'done', hits.length ? 'grounded' : '—');
			document.dispatchEvent(new CustomEvent('rag:answer'));
			return typeInto(body, answer);
		}).then(function () {
			renderSources(botMsg, hits);
			scrollLog();
		}).finally(function () {
			busy = false;
			submitBtn.disabled = false;
		});
	}

	form.addEventListener('submit', function (e) {
		e.preventDefault();
		var q = input.value;
		input.value = '';
		ask(q);
	});

	input.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'));
		}
	});

	document.querySelectorAll('[data-suggest]').forEach(function (btn) {
		btn.addEventListener('click', function () { ask(btn.textContent); });
	});

	// Exposed for debugging in the console, e.g. RAG.retrieve('spark tuning')
	window.RAG = {
		retrieve: function (q) { return index ? retrieve(index, q) : null; },
		answer: function (q) { return index ? composeAnswer(retrieve(index, q)) : null; }
	};
})();
