package lila.round

import strategygames.{ Color, Centis, Game, Replay }
import strategygames.chess.format.pgn.Glyphs
import strategygames.format.{ FEN, Forsyth, Uci, UciCharPair }
import strategygames.chess.opening._
import strategygames.variant.Variant
import JsonView.WithFlags
import lila.analyse.{ Advice, Analysis, Info }
import lila.tree._

object TreeBuilder {

  private type Ply       = Int
  private type OpeningOf = FEN => Option[FullOpening]

  private def makeEval(info: Info) =
    Eval(
      cp = info.cp,
      mate = info.mate,
      best = info.best
    )

  def apply(
      game: lila.game.Game,
      analysis: Option[Analysis],
      initialFen: FEN,
      withFlags: WithFlags
  ): Root = {
    val withClocks: Option[Vector[Centis]] = withFlags.clocks ?? game.bothClockStates
    val drawOfferPlies                     = game.drawOffers.normalizedPlies
    Replay.gameMoveWhileValid(
      strategygames.GameLib.Chess(),
      game.pgnMoves,
      initialFen,
      game.variant
    ) match {
      case (init, games, error) =>
        error foreach logChessError(game.id)
        val openingOf: OpeningOf =
          if (withFlags.opening && Variant.openingSensibleVariants(game.variant)) FullOpeningDB.findByFen
          else _ => None
        val fen                 = Forsyth.>>(strategygames.GameLib.Chess(), init)
        val infos: Vector[Info] = analysis.??(_.infos.toVector)
        val advices: Map[Ply, Advice] = analysis.??(_.advices.view.map { a =>
          a.ply -> a
        }.toMap)
        val root = Root(
          ply = init.turns,
          fen = fen,
          check = init.situation.check,
          opening = openingOf(fen),
          clock = withClocks.flatMap(_.headOption),
          crazyData = init.situation.board.crazyData,
          eval = infos lift 0 map makeEval
        )
        def makeBranch(index: Int, g: Game, m: Uci.WithSan) = {
          val fen    = Forsyth >> g
          val info   = infos lift (index - 1)
          val advice = advices get g.turns
          val branch = Branch(
            id = UciCharPair(m.uci),
            ply = g.turns,
            move = m,
            fen = fen,
            check = g.situation.check,
            opening = openingOf(fen),
            clock = withClocks flatMap (_ lift (g.turns - init.turns - 1)),
            crazyData = g.situation.board.crazyData,
            eval = info map makeEval,
            glyphs = Glyphs.fromList(advice.map(_.judgment.glyph).toList),
            comments = Node.Comments {
              drawOfferPlies(g.turns)
                .option(makePlayStrategyComment(s"${!Color.fromPly(strategygames.GameLib.Chess(), g.turns)} offers draw"))
                .toList :::
                advice
                  .map(_.makeComment(withEval = false, withBestMove = true))
                  .toList
                  .map(makePlayStrategyComment)
            }
          )
          advices.get(g.turns + 1).flatMap { adv =>
            games.lift(index - 1).map { case (fromGame, _) =>
              withAnalysisChild(game.id, branch, game.variant, Forsyth >> fromGame, openingOf)(adv.info)
            }
          } getOrElse branch
        }
        games.zipWithIndex.reverse match {
          case Nil => root
          case ((g, m), i) :: rest =>
            root prependChild rest.foldLeft(makeBranch(i + 1, g, m)) { case (node, ((g, m), i)) =>
              makeBranch(i + 1, g, m) prependChild node
            }
        }
    }
  }

  private def makePlayStrategyComment(text: String) =
    Node.Comment(
      Node.Comment.Id.make,
      Node.Comment.Text(text),
      Node.Comment.Author.PlayStrategy
    )

  private def withAnalysisChild(
      id: String,
      root: Branch,
      variant: Variant,
      fromFen: FEN,
      openingOf: OpeningOf
  )(info: Info): Branch = {
    def makeBranch(g: Game, m: Uci.WithSan) = {
      val fen = Forsyth >> g
      Branch(
        id = UciCharPair(m.uci),
        ply = g.turns,
        move = m,
        fen = fen,
        check = g.situation.check,
        opening = openingOf(fen),
        crazyData = g.situation.board.crazyData,
        eval = none
      )
    }
    Replay.gameMoveWhileValid(
      strategygames.GameLib.Chess(),
      info.variation take 20,
      fromFen,
      variant
    ) match {
      case (_, games, error) =>
        error foreach logChessError(id)
        games.reverse match {
          case Nil => root
          case (g, m) :: rest =>
            root addChild rest
              .foldLeft(makeBranch(g, m)) { case (node, (g, m)) =>
                makeBranch(g, m) addChild node
              }
              .setComp
        }
    }
  }

  private val logChessError = (id: String) =>
    (err: String) =>
      logger.warn(s"round.TreeBuilder https://playstrategy.org/$id ${err.linesIterator.toList.headOption}")
}
