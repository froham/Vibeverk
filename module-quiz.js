/* =============================================================================
   module-quiz.js  —  KJAPP SJEKK (interaktiv quiz)
   -----------------------------------------------------------------------------
   Selvstendig IIFE. Lastes etter core.js. Slås av/på med features.quiz
   (default AV, se config.js — nytt/uprøvd, samme konvensjon som sidebygger/
   sidetelling/qrCode).

   Vises som en inline-seksjon på forsiden (order 15, mellom Hjem og Om oss —
   plassert tidlig med vilje, som en konverteringsstarter rett under heltebildet,
   ikke en egen skjult side slik FAQ er).

   Besøkende svarer på N spørsmål (hvert med M svaralternativer), hvert
   alternativ har en tallverdi. Totalscore = summen av valgte verdier.
   Resultatet vises ut fra hvilket "tier" (min/max-scoreintervall) totalen
   havner i, med egen overskrift/tekst/CTA-lenke.

   VIKTIG, bevisst designbegrensning: denne modulen samler ALDRI inn eller
   lagrer noe om hvilke svar en besøkende faktisk valgte — poengsummen
   beregnes og glemmes i nettleserminnet, aldri sendt noe sted, aldri i
   localStorage. Ingen App.addLead()-kall, ingen consentPurposesField/
   buildConsentSnapshot — quiz-en er derfor UTENFOR personvern-/samtykke-
   plikten som gjelder kontaktskjema/booking/tilbud (se CLAUDE.md "AI agent
   workflow" — Privacy/Compliance Advisor-porten gjelder funksjoner som
   samler inn persondata, og denne gjør det aldri). Dette må IKKE endres i
   senere runder — hold fast ved det hvis noen foreslår "lagre svarene for
   innsikt" eller "send resultatet på e-post", siden begge ville reintrodusert
   nettopp det denne modulen er bevisst bygget for å unngå.

   Admin: CRUD for spørsmål (med tallverdi per svaralternativ) og resultat-
   tier (score-intervall + tekst + valgfri egen CTA) under «Quiz»-fanen.
   Antall spørsmål og antall tier er IKKE hardkodet — administrator legger
   selv til/fjerner rader, akkurat som FAQ sine spørsmål.
   ========================================================================== */
(function () {
  "use strict";

  var App = window.App, C = window.Components;
  if (!App || !C) return;

  App.ready(function (CFG) {
  if (CFG.features && CFG.features.quiz === false) return;

  var esc = C.esc;
  var QCF = CFG.quiz || {};
  var QUESTIONS_KEY = "quiz-questions";
  var TIERS_KEY = "quiz-tiers";
  var CONTENT_KEY = "quiz-content";

  /* =========================================================================
     LAGRING
     ====================================================================== */
  function getQuestions() { return App.store.get(QUESTIONS_KEY, []) || []; }
  function setQuestions(v) { App.store.set(QUESTIONS_KEY, v); }
  function getTiers() { return App.store.get(TIERS_KEY, []) || []; }
  function setTiers(v) { App.store.set(TIERS_KEY, v); }
  function getQuizContent() {
    return Object.assign(
      {
        heading: QCF.heading || "Kjapp sjekk",
        intro: QCF.intro || "",
        ctaDefaultLabel: "Book en prat",
        ctaDefaultHref: "#kontakt"
      },
      App.store.get(CONTENT_KEY, {}) || {}
    );
  }
  function setQuizContent(v) { App.store.set(CONTENT_KEY, v); }

  // Høgste moglege totalscore, gitt dagens spørsmål — brukt av admin til å
  // validere at tier-intervalla faktisk dekker heile det oppnåelege spennet.
  function maxPossibleScore(questions) {
    return questions.reduce(function (sum, q) {
      var vals = (q.choices || []).map(function (c) { return Number(c.value) || 0; });
      return sum + (vals.length ? Math.max.apply(null, vals) : 0);
    }, 0);
  }

  function findTier(tiers, score) {
    var match = tiers.find(function (t) { return score >= t.minScore && score <= t.maxScore; });
    if (match) return match;
    // Ingen tier dekker akkurat denne summen (hull i admin sitt oppsett) —
    // fall tilbake til næraste i staden for eit tomt resultat.
    if (!tiers.length) return null;
    return tiers.slice().sort(function (a, b) {
      var da = Math.min(Math.abs(score - a.minScore), Math.abs(score - a.maxScore));
      var db = Math.min(Math.abs(score - b.minScore), Math.abs(score - b.maxScore));
      return da - db;
    })[0];
  }

  /* =========================================================================
     STILER
     ====================================================================== */
  function injectStyles() {
    if (document.getElementById("quiz-styles")) return;
    var s = document.createElement("style");
    s.id = "quiz-styles";
    s.textContent = [
      ".quiz-intro{color:var(--color-muted);margin:0 0 1.6rem;max-width:680px}",
      ".quiz-box{max-width:640px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:16px;padding:2rem}",
      ".quiz-progress{display:flex;gap:.4rem;margin-bottom:1.6rem}",
      ".quiz-progress span{height:4px;flex:1;background:var(--color-border);border-radius:99px;overflow:hidden}",
      ".quiz-progress span i{display:block;height:100%;width:0%;background:var(--color-primary);transition:width .3s ease}",
      ".quiz-progress span.is-done i{width:100%}",
      ".quiz-step{display:none}",
      ".quiz-step.is-active{display:block}",
      ".quiz-q{font-weight:700;font-size:1.2rem;margin:0 0 1.2rem;line-height:1.4}",
      ".quiz-choices{display:grid;gap:.7rem}",
      ".quiz-choice{text-align:left;padding:.9rem 1.1rem;border:1.5px solid var(--color-border);border-radius:10px;background:none;font:inherit;font-size:.96rem;color:var(--color-text);cursor:pointer;transition:border-color .15s,background .15s}",
      ".quiz-choice:hover{border-color:var(--color-primary);background:var(--color-tint)}",
      ".quiz-result h3{margin:0 0 .8rem;font-size:1.3rem}",
      ".quiz-result p{color:var(--color-muted);line-height:1.65;margin:0 0 1.4rem;white-space:pre-wrap}",
      ".quiz-restart{background:none;border:0;color:var(--color-muted);font-size:.85rem;text-decoration:underline;cursor:pointer;margin-top:1rem;padding:0}",
      /* Admin */
      ".quiz-adm__head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.6rem}",
      ".quiz-adm__head h4{margin:0}",
      ".quiz-choice-row{display:flex;gap:.6rem;align-items:center;margin-bottom:.5rem}",
      ".quiz-choice-row input[type=text]{flex:1}",
      ".quiz-choice-row input[type=number]{width:5.5rem;flex:none}",
      ".quiz-tier-range{display:flex;gap:.8rem}",
      ".quiz-tier-range .field{flex:1}"
    ].join("");
    document.head.appendChild(s);
  }

  /* =========================================================================
     OFFENTLIG SEKSJON
     ====================================================================== */
  function renderSection() {
    var questions = getQuestions();
    var qc = getQuizContent();
    if (!questions.length) return "";   // ingen spørsmål lagt til → skjul heilt

    var progressHtml = questions.map(function (_, i) {
      return '<span data-quiz-bar="' + i + '"' + (i === 0 ? ' class="is-done"' : '') + '><i></i></span>';
    }).join("");

    var stepsHtml = questions.map(function (q, i) {
      var choicesHtml = (q.choices || []).map(function (c) {
        return '<button type="button" class="quiz-choice" data-quiz-choice-value="' + esc(c.value) + '">' + esc(c.label) + '</button>';
      }).join("");
      return '<div class="quiz-step' + (i === 0 ? ' is-active' : '') + '" data-quiz-step="' + i + '">' +
        '<p class="quiz-q">' + esc(q.text) + '</p>' +
        '<div class="quiz-choices">' + choicesHtml + '</div>' +
      '</div>';
    }).join("");

    var resultHtml = '<div class="quiz-step" data-quiz-step="result">' +
      '<div class="quiz-result">' +
        '<h3 data-quiz-result-heading></h3>' +
        '<p data-quiz-result-text></p>' +
        '<a class="btn btn--primary" data-quiz-cta href="#kontakt">Book en prat</a>' +
        '<div><button type="button" class="quiz-restart" data-quiz-restart>Ta quizen på nytt</button></div>' +
      '</div>' +
    '</div>';

    var introHtml = qc.intro ? '<p class="quiz-intro">' + esc(qc.intro) + '</p>' : "";

    return '<section id="quiz" class="section reveal"><div class="container">' +
      C.eyebrow("Kjapp sjekk") +
      '<h2 class="section__title">' + esc(qc.heading) + '</h2>' +
      introHtml +
      '<div class="quiz-box" data-quiz-box data-quiz-max-score="' + maxPossibleScore(questions) + '">' +
        '<div class="quiz-progress">' + progressHtml + '</div>' +
        stepsHtml +
        resultHtml +
      '</div>' +
    '</div></section>';
  }

  function mountSection(container) {
    var box = container.querySelector("[data-quiz-box]");
    if (!box) return;

    var questions = getQuestions();
    var tiers = getTiers();
    var qc = getQuizContent();
    var score = 0;

    function showStep(key) {
      box.querySelectorAll("[data-quiz-step]").forEach(function (el) {
        el.classList.toggle("is-active", el.getAttribute("data-quiz-step") === String(key));
      });
    }
    function updateBars(doneCount) {
      box.querySelectorAll("[data-quiz-bar]").forEach(function (el, i) {
        el.classList.toggle("is-done", i < doneCount);
      });
    }
    function showResult() {
      var tier = findTier(tiers, score);
      var headingEl = box.querySelector("[data-quiz-result-heading]");
      var textEl = box.querySelector("[data-quiz-result-text]");
      var ctaEl = box.querySelector("[data-quiz-cta]");
      if (tier) {
        headingEl.textContent = tier.heading || "";
        textEl.textContent = tier.message || "";
        ctaEl.textContent = tier.ctaLabel || qc.ctaDefaultLabel;
        ctaEl.setAttribute("href", tier.ctaHref || qc.ctaDefaultHref);
      } else {
        headingEl.textContent = "Takk for at du tok testen!";
        textEl.textContent = "";
        ctaEl.textContent = qc.ctaDefaultLabel;
        ctaEl.setAttribute("href", qc.ctaDefaultHref);
      }
      updateBars(box.querySelectorAll("[data-quiz-bar]").length);
      showStep("result");
    }

    var handler = function (e) {
      var choiceBtn = e.target.closest("[data-quiz-choice-value]");
      if (choiceBtn && box.contains(choiceBtn)) {
        var stepEl = choiceBtn.closest("[data-quiz-step]");
        var stepIndex = parseInt(stepEl.getAttribute("data-quiz-step"), 10);
        score += Number(choiceBtn.getAttribute("data-quiz-choice-value")) || 0;
        if (stepIndex < questions.length - 1) {
          updateBars(stepIndex + 1);
          showStep(stepIndex + 1);
        } else {
          showResult();
        }
        return;
      }
      var restartBtn = e.target.closest("[data-quiz-restart]");
      if (restartBtn && box.contains(restartBtn)) {
        score = 0;
        updateBars(0);
        showStep(0);
      }
    };
    container.removeEventListener("click", container._quizHandler);
    container._quizHandler = handler;
    container.addEventListener("click", handler);
  }

  /* =========================================================================
     ADMIN
     ====================================================================== */
  function renderAdmin(root) {
    var questions = getQuestions();
    var tiers = getTiers();
    var qc = getQuizContent();

    root.innerHTML =
      '<form class="admin-form admin-form--card" data-quiz-content-form style="margin-bottom:1.2rem">' +
        '<h4 style="margin:0 0 .8rem">Innstillinger</h4>' +
        C.field({ id:"quiz-heading", label:"Overskrift", value:qc.heading }) +
        C.field({ id:"quiz-intro",   label:"Ingress (valgfritt)", multiline:true, rows:2, value:qc.intro }) +
        C.field({ id:"quiz-cta-label", label:"Standard CTA-tekst", value:qc.ctaDefaultLabel,
          hint:"Vises på resultat-knappen med mindre et resultatnivå har sin egen tekst." }) +
        C.field({ id:"quiz-cta-href", label:"Standard CTA-lenke", value:qc.ctaDefaultHref,
          hint:"F.eks. #kontakt for å hoppe til kontaktseksjonen, eller en full lenke (f.eks. en bookingside)." }) +
        C.button({ label:"Lagre innstillinger", type:"submit", variant:"primary" }) +
        '<p class="form__status" data-quiz-content-status></p>' +
      '</form>' +

      '<div class="quiz-adm__head"><h4>Spørsmål</h4>' +
        C.button({ label:"Nytt spørsmål", icon:"plus", variant:"primary", attrs:"data-quiz-q-new" }) +
      '</div>' +
      '<ul class="admin-list" data-quiz-q-list>' +
        (questions.length ? questions.map(quizQuestionRow).join("") : '<li class="prose prose--muted">Ingen spørsmål ennå.</li>') +
      '</ul>' +
      '<div data-quiz-q-editor></div>' +

      '<div class="quiz-adm__head" style="margin-top:2rem"><h4>Resultatnivå</h4>' +
        C.button({ label:"Nytt nivå", icon:"plus", variant:"primary", attrs:"data-quiz-t-new" }) +
      '</div>' +
      '<p class="field__hint">Høgste moglege poengsum med dagens spørsmål: ' + maxPossibleScore(questions) + '. Kontroller at nivåa til saman dekker 0–' + maxPossibleScore(questions) + ' utan hull.</p>' +
      '<ul class="admin-list" data-quiz-t-list>' +
        (tiers.length ? tiers.map(quizTierRow).join("") : '<li class="prose prose--muted">Ingen resultatnivå ennå.</li>') +
      '</ul>' +
      '<div data-quiz-t-editor></div>';

    root.querySelector("[data-quiz-content-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      setQuizContent({
        heading: root.querySelector("#quiz-heading").value.trim() || QCF.heading || "Kjapp sjekk",
        intro:   root.querySelector("#quiz-intro").value.trim(),
        ctaDefaultLabel: root.querySelector("#quiz-cta-label").value.trim() || "Book en prat",
        ctaDefaultHref:  root.querySelector("#quiz-cta-href").value.trim() || "#kontakt"
      });
      var st = root.querySelector("[data-quiz-content-status]");
      st.textContent = "Lagret."; st.className = "form__status is-ok";
    });

    root.querySelector("[data-quiz-q-new]").addEventListener("click", function () { openQuestionEditor(root, null); });
    root.querySelectorAll("[data-quiz-q-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openQuestionEditor(root, b.getAttribute("data-quiz-q-edit")); });
    });
    root.querySelectorAll("[data-quiz-q-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        setQuestions(getQuestions().filter(function (x) { return x.id !== b.getAttribute("data-quiz-q-del"); }));
        renderAdmin(root);
      });
    });

    root.querySelector("[data-quiz-t-new]").addEventListener("click", function () { openTierEditor(root, null); });
    root.querySelectorAll("[data-quiz-t-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openTierEditor(root, b.getAttribute("data-quiz-t-edit")); });
    });
    root.querySelectorAll("[data-quiz-t-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        setTiers(getTiers().filter(function (x) { return x.id !== b.getAttribute("data-quiz-t-del"); }));
        renderAdmin(root);
      });
    });
  }

  function quizQuestionRow(q) {
    var choiceSummary = (q.choices || []).map(function (c) { return c.label + " (" + c.value + ")"; }).join(", ");
    return '<li class="admin-row">' +
      '<div class="admin-row__main"><strong>' + esc(q.text) + '</strong>' +
        (choiceSummary ? '<span class="admin-row__meta">' + esc(choiceSummary) + '</span>' : '') +
      '</div>' +
      '<div class="admin-row__actions">' +
        C.button({ label:"Rediger", variant:"ghost", attrs:'data-quiz-q-edit="' + esc(q.id) + '"' }) +
        C.button({ label:"Slett",   variant:"ghost", attrs:'data-quiz-q-del="'  + esc(q.id) + '"' }) +
      '</div>' +
    '</li>';
  }

  function quizTierRow(t) {
    return '<li class="admin-row">' +
      '<div class="admin-row__main"><strong>' + esc(t.heading) + '</strong>' +
        '<span class="admin-row__meta">Poeng ' + esc(t.minScore) + '–' + esc(t.maxScore) + '</span>' +
      '</div>' +
      '<div class="admin-row__actions">' +
        C.button({ label:"Rediger", variant:"ghost", attrs:'data-quiz-t-edit="' + esc(t.id) + '"' }) +
        C.button({ label:"Slett",   variant:"ghost", attrs:'data-quiz-t-del="'  + esc(t.id) + '"' }) +
      '</div>' +
    '</li>';
  }

  function choiceRowHtml(choice) {
    var c = choice || { label:"", value:0 };
    return '<div class="quiz-choice-row" data-quiz-choice-row>' +
      '<input type="text" placeholder="Svaralternativ" value="' + esc(c.label) + '" data-quiz-choice-label>' +
      '<input type="number" value="' + esc(c.value) + '" data-quiz-choice-value>' +
      C.button({ label:"Fjern", variant:"ghost", attrs:"data-quiz-choice-del" }) +
    '</div>';
  }

  function openQuestionEditor(root, id) {
    var questions = getQuestions();
    var q = id ? questions.find(function (x) { return x.id === id; }) : null;
    var choices = q ? (q.choices || []) : [{ label:"", value:0 }, { label:"", value:0 }];
    var ed = root.querySelector("[data-quiz-q-editor]");
    ed.innerHTML =
      '<form class="admin-form admin-form--card" data-quiz-q-form>' +
        '<h4>' + (q ? "Rediger spørsmål" : "Nytt spørsmål") + '</h4>' +
        C.field({ id:"quiz-q-text", label:"Spørsmål", required:true, value:q ? q.text : "" }) +
        '<label style="display:block;margin:.6rem 0 .4rem;font-weight:600">Svaralternativ (med poengverdi)</label>' +
        '<div data-quiz-choices>' + choices.map(choiceRowHtml).join("") + '</div>' +
        C.button({ label:"Legg til alternativ", variant:"ghost", attrs:"data-quiz-choice-add", icon:"plus" }) +
        '<div class="admin-row__actions" style="margin-top:1rem">' +
          C.button({ label:q ? "Oppdater" : "Legg til", type:"submit", variant:"primary" }) +
          C.button({ label:"Avbryt", variant:"ghost", attrs:"data-quiz-q-cancel" }) +
        '</div>' +
      '</form>';

    var choicesWrap = ed.querySelector("[data-quiz-choices]");
    ed.querySelector("[data-quiz-choice-add]").addEventListener("click", function () {
      choicesWrap.insertAdjacentHTML("beforeend", choiceRowHtml(null));
    });
    choicesWrap.addEventListener("click", function (e) {
      var delBtn = e.target.closest("[data-quiz-choice-del]");
      if (!delBtn) return;
      var row = delBtn.closest("[data-quiz-choice-row]");
      if (row && choicesWrap.querySelectorAll("[data-quiz-choice-row]").length > 1) row.remove();
    });

    ed.querySelector("[data-quiz-q-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
    ed.querySelector("[data-quiz-q-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var text = ed.querySelector("#quiz-q-text").value.trim();
      var choiceList = Array.prototype.slice.call(choicesWrap.querySelectorAll("[data-quiz-choice-row]")).map(function (row) {
        return {
          label: row.querySelector("[data-quiz-choice-label]").value.trim(),
          value: Number(row.querySelector("[data-quiz-choice-value]").value) || 0
        };
      }).filter(function (c) { return c.label; });
      if (!text || !choiceList.length) return;
      var list = getQuestions();
      var obj = { id: q ? q.id : ("quiz-q-" + Date.now()), text: text, choices: choiceList };
      if (q) { var idx = list.findIndex(function (x) { return x.id === q.id; }); list[idx] = obj; }
      else list.push(obj);
      setQuestions(list);
      renderAdmin(root);
    });
  }

  function openTierEditor(root, id) {
    var tiers = getTiers();
    var t = id ? tiers.find(function (x) { return x.id === id; }) : null;
    var ed = root.querySelector("[data-quiz-t-editor]");
    ed.innerHTML =
      '<form class="admin-form admin-form--card" data-quiz-t-form>' +
        '<h4>' + (t ? "Rediger resultatnivå" : "Nytt resultatnivå") + '</h4>' +
        '<div class="quiz-tier-range">' +
          C.field({ id:"quiz-t-min", label:"Frå poengsum", type:"number", required:true, value:t ? t.minScore : 0 }) +
          C.field({ id:"quiz-t-max", label:"Til poengsum", type:"number", required:true, value:t ? t.maxScore : 0 }) +
        '</div>' +
        C.field({ id:"quiz-t-heading", label:"Overskrift på resultatet", required:true, value:t ? t.heading : "" }) +
        C.field({ id:"quiz-t-message", label:"Tekst til besøkende", multiline:true, rows:3, value:t ? t.message : "" }) +
        C.field({ id:"quiz-t-cta-label", label:"Egen CTA-tekst (valgfritt)", value:t ? t.ctaLabel : "",
          hint:"Tom = bruker standard CTA-tekst fra innstillingene over." }) +
        C.field({ id:"quiz-t-cta-href", label:"Egen CTA-lenke (valgfritt)", value:t ? t.ctaHref : "",
          hint:"Tom = bruker standard CTA-lenke fra innstillingene over." }) +
        '<div class="admin-row__actions">' +
          C.button({ label:t ? "Oppdater" : "Legg til", type:"submit", variant:"primary" }) +
          C.button({ label:"Avbryt", variant:"ghost", attrs:"data-quiz-t-cancel" }) +
        '</div>' +
      '</form>';
    ed.querySelector("[data-quiz-t-cancel]").addEventListener("click", function () { ed.innerHTML = ""; });
    ed.querySelector("[data-quiz-t-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var heading = ed.querySelector("#quiz-t-heading").value.trim();
      if (!heading) return;
      var list = getTiers();
      var obj = {
        id: t ? t.id : ("quiz-t-" + Date.now()),
        minScore: Number(ed.querySelector("#quiz-t-min").value) || 0,
        maxScore: Number(ed.querySelector("#quiz-t-max").value) || 0,
        heading: heading,
        message: ed.querySelector("#quiz-t-message").value.trim(),
        ctaLabel: ed.querySelector("#quiz-t-cta-label").value.trim(),
        ctaHref: ed.querySelector("#quiz-t-cta-href").value.trim()
      };
      if (t) { var idx = list.findIndex(function (x) { return x.id === t.id; }); list[idx] = obj; }
      else list.push(obj);
      setTiers(list);
      renderAdmin(root);
    });
  }

  /* =========================================================================
     REGISTRERING
     ====================================================================== */
  injectStyles();
  App.registerModule({
    id:     "quiz",
    label:  getQuizContent().heading || "Kjapp sjekk",
    order:  15,          // mellom Hjem (10) og Om oss (20) — synleg tidleg på forsida
    render: renderSection,
    mount:  mountSection,
    admin: {
      label:  "Quiz",
      category: "innhold",
      render: function () { return '<div data-quiz-root></div>'; },
      mount:  function (body) { renderAdmin(body.querySelector("[data-quiz-root]") || body); }
    }
  });
  });
})();
