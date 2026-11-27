/*
 * 0179: публичный вход состояния задачи.
 *
 * Раньше здесь жила вся реализация (1643 строки); теперь это баррель: код
 * разложен по слоям plugin/lib/state/*.js, а путь импорта и все 55 имён
 * остались прежними — api.js, test/fixture.mjs и test/state.test.mjs не
 * правятся.
 *
 * Слои: constants → primitives → contract → policy → decisions → attack →
 * lock → acceptance → task-state → views → repository. Импорт идёт только
 * вниз по этому списку; циклов нет.
 */
export * from './state/constants.js';
export * from './state/primitives.js';
export * from './state/contract.js';
export * from './state/policy.js';
export * from './state/decisions.js';
export * from './state/attack.js';
export * from './state/lock.js';
export * from './state/acceptance.js';
export * from './state/task-state.js';
export * from './state/views.js';
export * from './state/repository.js';
