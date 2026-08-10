"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var client = require("./local-ai-client");
var testLocalAi = require("./test-local-ai").testLocalAi;

function validEnv(overrides) {
  return Object.assign({
    NODE_ENV: "development",
    AI_PROVIDER: "ollama",
    AI_MODEL: "gemma3:12b",
    AI_BASE_URL: "http://127.0.0.1:11434/v1",
  }, overrides || {});
}

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: async function () {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

test("sender OpenAI-formatet og skriv svaret til konsollen", async function () {
  var request;
  var output = [];
  var answer = await testLocalAi("Sei hei.", {
    env: validEnv(),
    fetchImpl: async function (url, init) {
      request = { url: url, init: init };
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hei!" } }] }), {
        headers: { "Content-Type": "application/json" },
      });
    },
    log: function (value) { output.push(value); },
  });

  assert.equal(request.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "error");
  assert.deepEqual(JSON.parse(request.init.body), {
    model: "gemma3:12b",
    messages: [{ role: "user", content: "Sei hei." }],
    stream: false,
  });
  assert.equal(answer, "Hei!");
  assert.deepEqual(output, ["Hei!"]);
});

test("sender strukturert output og temperatur når adapteren ber om det", async function () {
  var requestBody;
  var schema = {
    type: "object",
    properties: { status: { type: "string" } },
    required: ["status"],
  };
  var answer = await client.sendPrompt("Returner status.", {
    env: validEnv(),
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "status_response", strict: true, schema: schema },
    },
    temperature: 0,
    reasoningEffort: "none",
    fetchImpl: async function (url, init) {
      requestBody = JSON.parse(init.body);
      return fakeResponse(200, { choices: [{ message: { content: '{"status":"OK"}' } }] });
    },
  });

  assert.equal(answer, '{"status":"OK"}');
  assert.equal(requestBody.temperature, 0);
  assert.equal(requestBody.reasoning_effort, "none");
  assert.equal(requestBody.response_format.type, "json_schema");
  assert.deepEqual(requestBody.response_format.json_schema.schema, schema);
});

test("fjernar terminalstyring frå konsollutskrifta", async function () {
  var output = [];
  var unsafeAnswer = "\x1B[31mRaud\x1B[0m\nTrygg";
  var answer = await testLocalAi("Sei hei.", {
    env: validEnv(),
    fetchImpl: async function () {
      return fakeResponse(200, { choices: [{ message: { content: unsafeAnswer } }] });
    },
    log: function (value) { output.push(value); },
  });

  assert.equal(answer, unsafeAnswer);
  assert.deepEqual(output, ["Raud\nTrygg"]);
});

test("sperrar ikkje-lokale eller ikkje-utviklingsmiljø", async function (t) {
  await t.test("produksjon", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ NODE_ENV: "production" }) }),
      /sperra utanfor/
    );
  });
  await t.test("CI", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ CI: "true" }) }),
      /CI eller Vercel/
    );
  });
  await t.test("Vercel", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ VERCEL: "1" }) }),
      /CI eller Vercel/
    );
  });
  await t.test("NODE_USE_ENV_PROXY", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ NODE_USE_ENV_PROXY: "1" }) }),
      /miljøproxy/
    );
  });
  await t.test("NODE_OPTIONS --use-env-proxy", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ NODE_OPTIONS: "--use-env-proxy" }) }),
      /miljøproxy/
    );
  });
  await t.test("sitert NODE_OPTIONS --use-env-proxy", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv({ NODE_OPTIONS: "\"--use-env-proxy\"" }),
      }),
      /miljøproxy/
    );
  });
  await t.test("CLI --use-env-proxy", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv(), execArgv: ["--use-env-proxy"] }),
      /miljøproxy/
    );
  });
  await t.test("ekstern URL", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv({ AI_BASE_URL: "https://ollama.example/v1" }),
      }),
      /http:\/\/127\.0\.0\.1/
    );
  });
  var aliases = ["127.1", "2130706433", "0x7f000001"];
  for (var i = 0; i < aliases.length; i += 1) {
    var alias = aliases[i];
    await t.test("IP-alias " + alias, async function () {
      await assert.rejects(
        client.sendPrompt("Hei", {
          env: validEnv({ AI_BASE_URL: "http://" + alias + ":11434/v1" }),
        }),
        /bokstavleg/
      );
    });
  }
  await t.test("query i URL", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv({ AI_BASE_URL: "http://127.0.0.1:11434/v1?next=remote" }),
      }),
      /bokstavleg/
    );
  });
});

test("validerer konfigurasjon og prompt før nettverkskall", async function (t) {
  await t.test("manglande leverandør", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ AI_PROVIDER: "" }) }),
      /Mangler AI_PROVIDER/
    );
  });
  await t.test("ikkje-støtta leverandør", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ AI_PROVIDER: "openai" }) }),
      /AI_PROVIDER må vere `ollama`/
    );
  });
  await t.test("manglande base-URL", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ AI_BASE_URL: "" }) }),
      /Mangler AI_BASE_URL/
    );
  });
  await t.test("manglande modell", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ AI_MODEL: "" }) }),
      /Mangler AI_MODEL/
    );
  });
  await t.test("ugyldig modell", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", { env: validEnv({ AI_MODEL: "gemma3:12b\nannan" }) }),
      /MODEL er ugyldig/
    );
  });
  await t.test("tom prompt", async function () {
    var called = false;
    await assert.rejects(
      client.sendPrompt("  ", {
        env: validEnv(),
        fetchImpl: async function () { called = true; },
      }),
      /ikkje-tom tekst/
    );
    assert.equal(called, false);
  });
  await t.test("AI Lab kan auke promptgrensa eksplisitt utan å endre standarden", async function () {
    var longPrompt = "x".repeat(21000);
    await assert.rejects(client.sendPrompt(longPrompt, { env: validEnv() }), /maks 20000/);
    var answer = await client.sendPrompt(longPrompt, {
      env: validEnv(),
      maxPromptLength: 30000,
      fetchImpl: async function () {
        return fakeResponse(200, { choices: [{ message: { content: "OK" } }] });
      },
    });
    assert.equal(answer, "OK");
  });
});

test("gir tydelege API- og svarformatfeil", async function (t) {
  await t.test("HTTP-feil", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv(),
        fetchImpl: async function () {
          return fakeResponse(404, { error: { message: "model not found" } });
        },
      }),
      function (error) {
        assert.match(error.message, /HTTP 404/);
        assert.doesNotMatch(error.message, /model not found/);
        return true;
      }
    );
  });
  await t.test("ugyldig JSON", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv(),
        fetchImpl: async function () { return fakeResponse(200, "ikkje JSON"); },
      }),
      /ugyldig JSON/
    );
  });
  await t.test("manglande svarinnhald", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv(),
        fetchImpl: async function () { return fakeResponse(200, { choices: [] }); },
      }),
      /choices\[0\]/
    );
  });
  await t.test("avkorta svar", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv(),
        fetchImpl: async function () {
          return fakeResponse(200, {
            choices: [{ finish_reason: "length", message: { content: "{\"uferdig\":" } }],
          });
        },
      }),
      function (error) {
        return error.code === "LOCAL_AI_OUTPUT_TRUNCATED" && /kontekstvinduet/.test(error.message);
      }
    );
  });
  await t.test("nettverksfeil", async function () {
    await assert.rejects(
      client.sendPrompt("hemmeleg prompt", {
        env: validEnv(),
        fetchImpl: async function () { throw new Error("reflekterer hemmeleg prompt"); },
      }),
      function (error) {
        assert.match(error.message, /Fekk ikkje kontakt/);
        assert.doesNotMatch(error.message, /hemmeleg prompt/);
        return true;
      }
    );
  });
  await t.test("timeout gjeld òg svarinnhald", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv(),
        timeoutMs: 5,
        fetchImpl: async function (url, init) {
          return new Response(new ReadableStream({
            start: function (controller) {
              init.signal.addEventListener("abort", function () {
                controller.error(new Error("aborted"));
              }, { once: true });
            },
          }));
        },
      }),
      /svarte ikkje innan 5 ms/
    );
  });
  await t.test("for stort svar", async function () {
    await assert.rejects(
      client.sendPrompt("Hei", {
        env: validEnv(),
        fetchImpl: async function () {
          return new Response("x".repeat(1024 * 1024 + 1));
        },
      }),
      /større enn 1048576 byte/
    );
  });
});
