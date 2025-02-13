import { h } from 'snabbdom';
import * as ground from './ground';
import * as cg from 'chessground/types';
import { DrawShape } from 'chessground/draw';
import * as xhr from './xhr';
import { key2pos } from 'chessground/util';
import { bind, onInsert } from './util';
import RoundController from './ctrl';
import { MaybeVNode } from './interfaces';

interface Promoting {
  move: [cg.Key, cg.Key];
  pre: boolean;
  meta: cg.MoveMetadata;
}

let promoting: Promoting | undefined;
let prePromotionRole: cg.Role | undefined;

export function sendPromotion(
  ctrl: RoundController,
  orig: cg.Key,
  dest: cg.Key,
  role: cg.Role,
  meta: cg.MoveMetadata
): boolean {
  const piece = ctrl.chessground.state.pieces.get(dest);
  if (['shogi', 'minishogi'].includes(ctrl.data.game.variant.key) && piece && piece.role === role) {
    // shogi decision not to promote
    ctrl.sendMove(orig, dest, undefined, ctrl.data.game.variant.key, meta);
  } else {
    ground.promote(ctrl.chessground, dest, role);
    ctrl.sendMove(orig, dest, role, ctrl.data.game.variant.key, meta);
  }
  return true;
}

function possiblePromotion(
  ctrl: RoundController,
  orig: cg.Key,
  dest: cg.Key,
  variant: VariantKey
): boolean | undefined {
  const d = ctrl.data,
    piece = ctrl.chessground.state.pieces.get(dest),
    premovePiece = ctrl.chessground.state.pieces.get(orig);
  switch (variant) {
    case 'minixiangqi':
    case 'xiangqi':
    case 'flipello':
      return false;
    case 'shogi':
      return (
        ((piece && !piece.promoted && piece.role !== 'k-piece' && piece.role !== 'g-piece' && !premovePiece) ||
          (premovePiece &&
            !premovePiece.promoted &&
            premovePiece.role !== 'k-piece' &&
            premovePiece.role !== 'g-piece')) &&
        ((d.player.playerIndex === 'p1' && (['7', '8', '9'].includes(dest[1]) || ['7', '8', '9'].includes(orig[1]))) ||
          (d.player.playerIndex === 'p2' &&
            (['1', '2', '3'].includes(dest[1]) || ['1', '2', '3'].includes(orig[1])))) &&
        orig != 'a0' // cant promote from a drop
      );
    case 'minishogi':
      return (
        ((piece && !piece.promoted && piece.role !== 'k-piece' && piece.role !== 'g-piece' && !premovePiece) ||
          (premovePiece &&
            !premovePiece.promoted &&
            premovePiece.role !== 'k-piece' &&
            premovePiece.role !== 'g-piece')) &&
        ((d.player.playerIndex === 'p1' && (['5'].includes(dest[1]) || ['5'].includes(orig[1]))) ||
          (d.player.playerIndex === 'p2' && (['1'].includes(dest[1]) || ['1'].includes(orig[1])))) &&
        orig != 'a0' // cant promote from a drop
      );
    default:
      return (
        ((piece && piece.role === 'p-piece' && !premovePiece) || (premovePiece && premovePiece.role === 'p-piece')) &&
        ((dest[1] === '8' && d.player.playerIndex === 'p1') || (dest[1] === '1' && d.player.playerIndex === 'p2'))
      );
  }
}

// forced promotion for shogi Knight in last two ranks, and lance or pawn in last rank
// assumes possible promotion is passed through (therefore no checks for drops etc).
function forcedShogiPromotion(ctrl: RoundController, orig: cg.Key, dest: cg.Key): boolean | undefined {
  const d = ctrl.data,
    piece = ctrl.chessground.state.pieces.get(dest),
    premovePiece = ctrl.chessground.state.pieces.get(orig);
  return (
    (((piece && (piece.role === 'l-piece' || piece.role === 'p-piece') && !premovePiece) ||
      (premovePiece && (premovePiece.role === 'l-piece' || premovePiece.role === 'p-piece'))) &&
      ((dest[1] === '9' && d.player.playerIndex === 'p1') || (dest[1] == '1' && d.player.playerIndex === 'p2'))) ||
    (((piece && piece.role === 'n-piece' && !premovePiece) || (premovePiece && premovePiece.role === 'n-piece')) &&
      ((['8', '9'].includes(dest[1]) && d.player.playerIndex === 'p1') ||
        (['1', '2'].includes(dest[1]) && d.player.playerIndex === 'p2')))
  );
}

// forced promotion for shogi pawn in last rank
// assumes possible promotion is passed through (therefore no checks for drops etc).
function forcedMiniShogiPromotion(ctrl: RoundController, orig: cg.Key, dest: cg.Key): boolean | undefined {
  const d = ctrl.data,
    piece = ctrl.chessground.state.pieces.get(dest),
    premovePiece = ctrl.chessground.state.pieces.get(orig);
  return (
    ((piece && piece.role === 'p-piece' && !premovePiece) || (premovePiece && premovePiece.role === 'p-piece')) &&
    ((dest[1] === '5' && d.player.playerIndex === 'p1') || (dest[1] == '1' && d.player.playerIndex === 'p2'))
  );
}

export function start(
  ctrl: RoundController,
  orig: cg.Key,
  dest: cg.Key,
  meta: cg.MoveMetadata = {} as cg.MoveMetadata
): boolean {
  const d = ctrl.data,
    premovePiece = ctrl.chessground.state.pieces.get(orig),
    piece = ctrl.chessground.state.pieces.get(dest),
    variantKey = ctrl.data.game.variant.key;
  if (possiblePromotion(ctrl, orig, dest, variantKey)) {
    if (variantKey === 'shogi' && forcedShogiPromotion(ctrl, orig, dest)) {
      const role = premovePiece ? premovePiece.role : piece!.role;
      return sendPromotion(ctrl, orig, dest, ('p' + role) as cg.Role, meta);
    }
    if (variantKey === 'minishogi' && forcedMiniShogiPromotion(ctrl, orig, dest)) {
      const role = premovePiece ? premovePiece.role : piece!.role;
      return sendPromotion(ctrl, orig, dest, ('p' + role) as cg.Role, meta);
    }
    if (prePromotionRole && meta && meta.premove) return sendPromotion(ctrl, orig, dest, prePromotionRole, meta);
    if (
      !meta.ctrlKey &&
      !promoting &&
      (d.pref.autoQueen === Prefs.AutoQueen.Always ||
        (d.pref.autoQueen === Prefs.AutoQueen.OnPremove && premovePiece) ||
        ctrl.keyboardMove?.justSelected())
    ) {
      if (premovePiece) {
        if (variantKey === 'shogi' || variantKey === 'minishogi') {
          setPrePromotion(ctrl, dest, ('p' + premovePiece.role) as cg.Role);
        } else {
          setPrePromotion(ctrl, dest, 'q-piece');
        }
      } else sendPromotion(ctrl, orig, dest, 'q-piece', meta);
      return true;
    }
    promoting = {
      move: [orig, dest],
      pre: !!premovePiece,
      meta,
    };
    ctrl.redraw();
    return true;
  }
  return false;
}

function setPrePromotion(ctrl: RoundController, dest: cg.Key, role: cg.Role): void {
  prePromotionRole = role;
  ctrl.chessground.setAutoShapes([
    {
      orig: dest,
      piece: {
        playerIndex: ctrl.data.player.playerIndex,
        role,
        opacity: 0.8,
      },
      brush: '',
    } as DrawShape,
  ]);
}

export function cancelPrePromotion(ctrl: RoundController) {
  if (prePromotionRole) {
    ctrl.chessground.setAutoShapes([]);
    prePromotionRole = undefined;
    ctrl.redraw();
  }
}

function finish(ctrl: RoundController, role: cg.Role) {
  if (promoting) {
    const info = promoting;
    promoting = undefined;
    if (info.pre) setPrePromotion(ctrl, info.move[1], role);
    else sendPromotion(ctrl, info.move[0], info.move[1], role, info.meta);
    ctrl.redraw();
  }
}

export function cancel(ctrl: RoundController) {
  cancelPrePromotion(ctrl);
  ctrl.chessground.cancelPremove();
  if (promoting) xhr.reload(ctrl).then(ctrl.reload, playstrategy.reload);
  promoting = undefined;
}

function renderPromotion(
  ctrl: RoundController,
  dest: cg.Key,
  roles: cg.Role[],
  playerIndex: PlayerIndex,
  orientation: cg.Orientation
): MaybeVNode {
  const rows = ctrl.chessground.state.dimensions.height;
  const columns = ctrl.chessground.state.dimensions.width;
  let left = (columns - key2pos(dest)[0]) * (100 / columns);
  if (orientation === 'p1') left = 100 - 100 / columns - left;
  const vertical = playerIndex === orientation ? 'top' : 'bottom';

  return h(
    'div#promotion-choice.' + vertical,
    {
      hook: onInsert(el => {
        el.addEventListener('click', () => cancel(ctrl));
        el.addEventListener('contextmenu', e => {
          e.preventDefault();
          return false;
        });
      }),
    },
    roles.map((serverRole, i) => {
      let top = 0;
      if (playerIndex === orientation) {
        if (playerIndex === 'p1') {
          top = (rows - key2pos(dest)[1] + i) * (100 / rows);
        } else {
          top = (key2pos(dest)[1] - 1 + i) * (100 / rows);
        }
      } else {
        if (playerIndex === 'p1') {
          top = (key2pos(dest)[1] - 1 - i) * (100 / rows);
        } else {
          top = (rows - key2pos(dest)[1] - i) * (100 / rows);
        }
      }

      return h(
        'square',
        {
          attrs: {
            style: `top:${top}%;left:${left}%`,
          },
          hook: bind('click', e => {
            e.stopPropagation();
            finish(ctrl, serverRole);
          }),
        },
        [h(`piece.${serverRole}.${playerIndex}.ally`)]
      );
    })
  );
}

const roles: cg.Role[] = ['q-piece', 'n-piece', 'r-piece', 'b-piece'];

export function view(ctrl: RoundController): MaybeVNode {
  if (!promoting) return;
  const piece = ctrl.chessground.state.pieces.get(promoting.move[1]),
    varaintKey = ctrl.data.game.variant.key,
    rolesToChoose =
      varaintKey === 'shogi' || varaintKey === 'minishogi'
        ? (['p' + piece?.role, piece?.role] as cg.Role[])
        : varaintKey === 'antichess'
        ? roles.concat('k-piece')
        : roles;
  return renderPromotion(
    ctrl,
    promoting.move[1],
    rolesToChoose,
    ctrl.data.player.playerIndex,
    ctrl.chessground.state.orientation
  );
}
