/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import PluginImmer from './plugin-immer';
import PluginRandom from './plugin-random';
import PluginEvents from './plugin-events';
import {
  PartialGameState,
  State,
  GameConfig,
  Plugin,
  Ctx,
  ActionShape,
} from '../types';

interface PluginOpts {
  game: GameConfig;
  isClient?: boolean;
}

/**
 * List of plugins that are always added.
 */
const DEFAULT_PLUGINS = [PluginImmer, PluginRandom, PluginEvents];

/**
 * Allow plugins to intercept actions and process them.
 */
export const ProcessAction = (
  state: State,
  action: ActionShape.Plugin,
  opts: PluginOpts
): State => {
  opts.game.plugins
    .filter(plugin => plugin.action !== undefined)
    .filter(plugin => plugin.name === action.payload.type)
    .forEach(plugin => {
      const name = plugin.name;
      const pluginState = state.plugins[name] || { data: {} };
      const data = plugin.action(pluginState.data, action.payload);

      state = {
        ...state,
        plugins: {
          ...state.plugins,
          [name]: { ...pluginState, data },
        },
      };
    });
  return state;
};

/**
 * The API's created by various plugins are stored in the plugins
 * section of the state object:
 *
 * {
 *   G: {},
 *   ctx: {},
 *   plugins: {
 *     plugin-a: {
 *       data: {},  // this is generated by the plugin at Setup / Flush.
 *       api: {},   // this is ephemeral and generated by Enhance.
 *     }
 *   }
 * }
 *
 * This function takes these API's and stuffs them back into
 * ctx for consumption inside a move function or hook.
 */
export const EnhanceCtx = (state: PartialGameState): Ctx => {
  let ctx = { ...state.ctx };
  const plugins = state.plugins || {};
  Object.entries(plugins).forEach(([name, { api }]) => {
    ctx[name] = api;
  });
  return ctx;
};

/**
 * Applies the provided plugins to the given move / flow function.
 *
 * @param {function} fn - The move function or trigger to apply the plugins to.
 * @param {object} plugins - The list of plugins.
 */
export const FnWrap = (fn: (...args: any[]) => any, plugins: Plugin[]) => {
  const reducer = (acc, { fnWrap }) => fnWrap(acc, plugins);
  return [...DEFAULT_PLUGINS, ...plugins]
    .filter(plugin => plugin.fnWrap !== undefined)
    .reduce(reducer, fn);
};

/**
 * Allows the plugin to generate its initial state.
 */
export const Setup = (
  state: PartialGameState,
  opts: PluginOpts
): PartialGameState => {
  [...DEFAULT_PLUGINS, ...opts.game.plugins]
    .filter(plugin => plugin.setup !== undefined)
    .forEach(plugin => {
      const name = plugin.name;
      const data = plugin.setup({
        G: state.G,
        ctx: state.ctx,
        game: opts.game,
      });

      state = {
        ...state,
        plugins: {
          ...state.plugins,
          [name]: { data },
        },
      };
    });
  return state;
};

/**
 * Invokes the plugin before a move or event.
 * The API that the plugin generates is stored inside
 * the `plugins` section of the state (which is subsequently
 * merged into ctx).
 */
export const Enhance = (state: State, opts: PluginOpts): State => {
  [...DEFAULT_PLUGINS, ...opts.game.plugins]
    .filter(plugin => plugin.api !== undefined)
    .forEach(plugin => {
      const name = plugin.name;
      const pluginState = state.plugins[name] || { data: {} };

      const api = plugin.api({
        G: state.G,
        ctx: state.ctx,
        data: pluginState.data,
        game: opts.game,
      });

      state = {
        ...state,
        plugins: {
          ...state.plugins,
          [name]: { ...pluginState, api },
        },
      };
    });
  return state;
};

/**
 * Allows plugins to update their state after a move / event.
 */
export const Flush = (state: State, opts: PluginOpts): State => {
  [...DEFAULT_PLUGINS, ...opts.game.plugins].forEach(plugin => {
    const name = plugin.name;
    const pluginState = state.plugins[name] || { data: {} };

    if (plugin.flush) {
      const newData = plugin.flush({
        G: state.G,
        ctx: state.ctx,
        game: opts.game,
        api: pluginState.api,
        data: pluginState.data,
      });

      state = {
        ...state,
        plugins: {
          ...state.plugins,
          [plugin.name]: { data: newData },
        },
      };
    } else if (plugin.flushRaw) {
      state = plugin.flushRaw({
        state,
        game: opts.game,
        api: pluginState.api,
        data: pluginState.data,
      });

      // Remove everything other than data.
      const data = state.plugins[name].data;
      state = {
        ...state,
        plugins: {
          ...state.plugins,
          [plugin.name]: { data },
        },
      };
    }
  });

  return state;
};

/**
 * Allows plugins to indicate if they should not be materialized on the client.
 * This will cause the client to discard the state update and wait for the
 * master instead.
 */
export const NoClient = (state: State, opts: PluginOpts): boolean => {
  return [...DEFAULT_PLUGINS, ...opts.game.plugins]
    .filter(plugin => plugin.noClient !== undefined)
    .map(plugin => {
      const name = plugin.name;
      const pluginState = state.plugins[name];

      if (pluginState) {
        return plugin.noClient({
          G: state.G,
          ctx: state.ctx,
          game: opts.game,
          api: pluginState.api,
          data: pluginState.data,
        });
      }

      return false;
    })
    .some(value => value === true);
};
