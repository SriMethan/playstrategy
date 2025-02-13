import * as keyboard from '../keyboard';
import * as promotion from '../promotion';
import * as util from '../util';
import crazyView from '../crazy/crazyView';
import RoundController from '../ctrl';
import { h, VNode } from 'snabbdom';
import { plyStep } from '../round';
import { Position, MaterialDiff, MaterialDiffSide, CheckCount } from '../interfaces';
import { read as fenRead } from 'chessground/fen';
import { render as keyboardMove } from '../keyboardMove';
import { render as renderGround } from '../ground';
import { renderTable } from './table';

function renderMaterial(
  material: MaterialDiffSide,
  score: number,
  position: Position,
  noMaterial: boolean,
  checks?: number
) {
  if (noMaterial) return;
  const children: VNode[] = [];
  let role: string, i: number;
  for (role in material) {
    if (material[role] > 0) {
      const content: VNode[] = [];
      for (i = 0; i < material[role]; i++) content.push(h('mpiece.' + role));
      children.push(h('div', content));
    }
  }
  if (checks) for (i = 0; i < checks; i++) children.push(h('div', h('mpiece.k-piece')));
  if (score > 0) children.push(h('score', '+' + score));
  return h('div.material.material-' + position, children);
}

function renderPlayerScore(score: number, position: Position, playerIndex: string): VNode | undefined {
  if (score == -1) {
    return undefined;
  }
  const children: VNode[] = [];
  children.push(h('piece.p-piece.' + playerIndex, { attrs: { 'data-score': score } }));
  return h('div.game-score.game-score-' + position, children);
}

function wheel(ctrl: RoundController, e: WheelEvent): void {
  if (!ctrl.isPlaying()) {
    e.preventDefault();
    if (e.deltaY > 0) keyboard.next(ctrl);
    else if (e.deltaY < 0) keyboard.prev(ctrl);
    ctrl.redraw();
  }
}

const emptyMaterialDiff: MaterialDiff = {
  p1: {},
  p2: {},
};

export function main(ctrl: RoundController): VNode {
  const d = ctrl.data,
    cgState = ctrl.chessground && ctrl.chessground.state,
    topPlayerIndex = d[ctrl.flip ? 'player' : 'opponent'].playerIndex,
    bottomPlayerIndex = d[ctrl.flip ? 'opponent' : 'player'].playerIndex,
    boardSize = d.game.variant.boardSize;
  let topScore = -1,
    bottomScore = -1;
  if (d.game.variant.key === 'flipello') {
    const pieces = cgState ? cgState.pieces : fenRead(plyStep(ctrl.data, ctrl.ply).fen, boardSize);
    const p1Score = util.getPlayerScore(d.game.variant.key, pieces, 'p1');
    const p2Score = util.getPlayerScore(d.game.variant.key, pieces, 'p2');
    topScore = topPlayerIndex === 'p1' ? p1Score : p2Score;
    bottomScore = topPlayerIndex === 'p2' ? p1Score : p2Score;
  }

  let material: MaterialDiff,
    score = 0;
  if (d.pref.showCaptured) {
    const pieces = cgState ? cgState.pieces : fenRead(plyStep(ctrl.data, ctrl.ply).fen, boardSize);
    material = util.getMaterialDiff(pieces);
    score = util.getScore(d.game.variant.key, pieces) * (bottomPlayerIndex === 'p1' ? 1 : -1);
  } else material = emptyMaterialDiff;

  const checks: CheckCount =
    d.player.checks || d.opponent.checks ? util.countChecks(ctrl.data.steps, ctrl.ply) : util.noChecks;

  // fix coordinates for non-chess games to display them outside due to not working well displaying on board
  if (['xiangqi', 'shogi', 'minixiangqi', 'minishogi', 'flipello'].includes(d.game.variant.key)) {
    if (!$('body').hasClass('coords-no')) {
      $('body').removeClass('coords-in').addClass('coords-out');
    }
  }

  //Add piece-letter class for games which dont want Noto Chess (font-famliy)
  const notationBasic = ['xiangqi', 'shogi', 'minixiangqi', 'minishogi'].includes(d.game.variant.key)
    ? '.piece-letter'
    : '';

  return ctrl.nvui
    ? ctrl.nvui.render(ctrl)
    : h(
        `div.round__app.variant-${d.game.variant.key}${notationBasic}.${d.game.gameFamily}`,
        {
          class: { 'move-confirm': !!(ctrl.moveToSubmit || ctrl.dropToSubmit) },
        },
        [
          h(
            'div.round__app__board.main-board' + (ctrl.data.pref.blindfold ? '.blindfold' : ''),
            {
              hook:
                'ontouchstart' in window
                  ? undefined
                  : util.bind('wheel', (e: WheelEvent) => wheel(ctrl, e), undefined, false),
            },
            [renderGround(ctrl), promotion.view(ctrl)]
          ),
          renderPlayerScore(topScore, 'top', topPlayerIndex),
          crazyView(ctrl, topPlayerIndex, 'top') ||
            renderMaterial(material[topPlayerIndex], -score, 'top', d.onlyDropsVariant, checks[topPlayerIndex]),
          ...renderTable(ctrl),
          crazyView(ctrl, bottomPlayerIndex, 'bottom') ||
            renderMaterial(material[bottomPlayerIndex], score, 'bottom', d.onlyDropsVariant, checks[bottomPlayerIndex]),
          renderPlayerScore(bottomScore, 'bottom', bottomPlayerIndex),
          ctrl.keyboardMove ? keyboardMove(ctrl.keyboardMove) : null,
        ]
      );
}
