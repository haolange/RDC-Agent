(function (global) {
  const { mount, headline } = global.CotRender;
  const { t, getLocale } = global.CotI18n;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildDemoModel(phase) {
    const locale = getLocale();
    const commentary = locale === 'en'
      ? '<p>I will inspect the capture pipeline, draft a short plan, then summarize findings.</p>'
      : '<p>我会先检查 capture 管线，生成简短计划，再汇总结论。</p>';
    const thinkingPreview = locale === 'en'
      ? 'Need file layout first, then confirm RDX context ownership before editing.'
      : '先确认文件布局，再核对 RDX 上下文归属，然后才能安全修改。';
    const finalHtml = locale === 'en'
      ? '<p>Capture ownership is healthy. Plan saved; next step is replay validation.</p><ul><li>Context lease OK</li><li>No stray CLI inventory</li></ul>'
      : '<p>Capture 归属正常。计划已保存；下一步做 replay 校验。</p><ul><li>上下文租约正常</li><li>无 CLI catalog 泄露</li></ul>';

    const base = {
      status: 'running',
      expanded: true,
      meta: '',
      sections: [{
        status: 'running',
        thinking: {
          kind: 'raw',
          status: 'streaming',
          open: true,
          preview: thinkingPreview,
        },
        prose: null,
        items: [],
      }],
      extras: [],
      finalHtml: '',
    };

    if (phase === 0) return base;

    if (phase >= 1) {
      base.sections[0].thinking.preview = thinkingPreview;
    }
    if (phase >= 2) {
      base.sections[0].prose = { html: commentary, streaming: phase < 3 };
    }
    if (phase >= 3) {
      base.sections[0].prose.streaming = false;
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'read_file',
          status: phase === 3 ? 'running' : 'complete',
          path: 'src/main/sessions/RdxRuntimeContextRegistry.ts',
          expandable: true,
          preview: 'export class RdxRuntimeContextRegistry { ... }',
          raw: '{"path":"src/main/sessions/RdxRuntimeContextRegistry.ts"}',
        },
      });
    }
    if (phase >= 4) {
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'grep',
          status: 'complete',
          summary: locale === 'en' ? '12 matches · 3 files' : '12 处匹配 · 3 个文件',
          samples: [
            'src/main/sessions/RdxRuntimeContextRegistry.ts:41',
            'src/main/workflow/debugger/AgentOrchestrator.ts:188',
          ],
        },
      });
    }
    if (phase >= 5) {
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'bash',
          status: phase === 5 ? 'running' : 'complete',
          command: 'pnpm run check:work-process',
          expandable: true,
          stdout: '[work-process] OK',
          raw: '{"exitCode":0}',
        },
      });
    }
    if (phase >= 6) {
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'web_search',
          status: 'complete',
          summary: locale === 'en' ? '3 sources' : '3 个来源',
          sources: [
            { domain: 'github.com', title: 'RenderDoc docs' },
            { domain: 'khronos.org', title: 'Vulkan overview' },
            { domain: 'learn.microsoft.com', title: 'PIX notes' },
          ],
        },
      });
    }
    if (phase >= 7) {
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'web_fetch',
          status: 'complete',
          page: { domain: 'renderdoc.org', title: 'RenderDoc' },
        },
      });
    }
    if (phase >= 8) {
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'mcp__filesystem__list_dir',
          status: 'complete',
          body: 'mcp · filesystem/list_dir · 18 entries',
        },
      });
    }
    if (phase >= 9) {
      base.sections[0].items.push({
        type: 'tool',
        tool: {
          name: 'plan_artifact',
          status: phase === 9 ? 'running' : 'complete',
          body: 'Plan artifact saved: artifacts/plan.md',
          path: 'artifacts/plan.md',
        },
      });
      base.extras = [{
        type: 'task',
        task: {
          title: locale === 'en' ? 'Validate replay device path' : '校验 Replay Device 路径',
          status: phase >= 11 ? 'completed' : 'in_progress',
        },
      }];
    }
    if (phase >= 10) {
      base.extras.unshift({
        type: 'summary',
        text: t('compact'),
      });
    }
    if (phase >= 11) {
      base.status = 'complete';
      base.duration = '18s';
      base.actionCount = 8;
      base.meta = '';
      base.sections[0].status = 'complete';
      base.sections[0].thinking = {
        kind: 'raw',
        status: 'complete',
        open: false,
        duration: '4s',
        preview: thinkingPreview,
      };
      base.finalHtml = finalHtml;
    } else {
      // While section is still running, thinking stays live even after prose/tools arrive
      // (resolveSectionThinking: isActiveBlock →「正在思考」+ openByDefault).
      base.sections[0].thinking.status = 'streaming';
      base.sections[0].thinking.open = true;
    }
    return base;
  }

  function createPlayer(options) {
    const mountEl = typeof options.mount === 'string'
      ? document.querySelector(options.mount)
      : options.mount;
    const finalEl = typeof options.finalMount === 'string'
      ? document.querySelector(options.finalMount)
      : options.finalMount;
    const maxPhase = 11;
    let phase = options.startPhase ?? 0;
    let timer = null;
    let playing = false;
    let model = buildDemoModel(phase);

    function render() {
      model = buildDemoModel(phase);
      mount(mountEl, model);
      if (finalEl) {
        if (model.finalHtml) {
          finalEl.classList.remove('hidden');
          finalEl.innerHTML = `<div class="conversation-bubble conversation-bubble-assistant"><div class="markdown-body">${model.finalHtml}</div></div>`;
        } else {
          finalEl.classList.add('hidden');
          finalEl.innerHTML = '';
        }
      }
      options.onTick?.({ phase, playing, model });
    }

    function stopTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function schedule() {
      stopTimer();
      if (!playing || phase >= maxPhase) {
        playing = false;
        options.onTick?.({ phase, playing, model });
        return;
      }
      timer = setTimeout(() => {
        phase += 1;
        render();
        schedule();
      }, options.intervalMs || 700);
    }

    function play() {
      if (phase >= maxPhase) phase = 0;
      playing = true;
      render();
      schedule();
    }

    function pause() {
      playing = false;
      stopTimer();
      options.onTick?.({ phase, playing, model });
    }

    function replay() {
      pause();
      phase = 0;
      play();
    }

    function jumpDone() {
      pause();
      phase = maxPhase;
      render();
    }

    function refreshLabels() {
      render();
    }

    document.addEventListener('cot:locale', refreshLabels);

    render();

    return { play, pause, replay, jumpDone, render, getPhase: () => phase, isPlaying: () => playing };
  }

  global.CotMockRuntime = { createPlayer, buildDemoModel, headline };
})(window);
