package lila.fishnet

import cats.data.Validated
import cats.data.Validated.valid
import cats.implicits._
import strategygames.format.pgn.Dumper
import strategygames.format.Uci
import strategygames.chess.Drop
import strategygames.{ GameLib, Move, Replay, Situation }

import lila.analyse.{ Analysis, Info, PgnMove }
import lila.base.LilaException

// convert variations from UCI to PGN.
// also drops extra variations
private object UciToPgn {

  type WithErrors[A] = (A, List[Exception])

  def apply(replay: Replay, analysis: Analysis): WithErrors[Analysis] = {

    val pliesWithAdviceAndVariation: Set[Int] = analysis.advices.view.collect {
      case a if a.info.hasVariation => a.ply
    } to Set

    val onlyMeaningfulVariations: List[Info] = analysis.infos map { info =>
      if (pliesWithAdviceAndVariation(info.ply)) info
      else info.dropVariation
    }

    def uciToPgn(ply: Int, variation: List[String]): Validated[String, List[PgnMove]] =
      for {
        situation <-
          if (ply == replay.setup.startedAtTurn + 1) valid(replay.setup.situation)
          else replay moveAtPly ply map (_.fold(_.situationBefore, drop => Situation.Chess(drop.situationBefore))) toValid "No move found"
        ucis <- variation.map(v => Uci.apply(GameLib.Chess(), v)).sequence toValid "Invalid UCI moves " + variation
        moves <-
          ucis.foldLeft[Validated[String, (Situation, List[Either[Move, Drop]])]](valid(situation -> Nil)) {
            case (Validated.Valid((sit, moves)), uci: Uci.Move) =>
              sit.move(uci.orig, uci.dest, uci.promotion).leftMap(e => s"ply $ply $e") map { move =>
                move.situationAfter -> (Left(move) :: moves)
              }
            case (Validated.Valid((Situation.Chess(sit), moves)), uci: strategygames.chess.format.Uci.Drop) =>
              sit.drop(uci.role, uci.pos).leftMap(e => s"ply $ply $e") map { drop =>
                Situation.Chess(drop.situationAfter) -> (Right(drop) :: moves)
              }
            case (failure, _) => failure
          }
      } yield moves._2.reverse map (_.fold(
        move => Dumper.apply(GameLib.Chess(), move),
        drop => strategygames.chess.format.pgn.Dumper.apply(drop)
      ))

    onlyMeaningfulVariations.foldLeft[WithErrors[List[Info]]]((Nil, Nil)) {
      case ((infos, errs), info) if info.variation.isEmpty => (info :: infos, errs)
      case ((infos, errs), info) =>
        uciToPgn(info.ply, info.variation).fold(
          err => (info.dropVariation :: infos, LilaException(err) :: errs),
          pgn => (info.copy(variation = pgn) :: infos, errs)
        )
    } match {
      case (infos, errors) => analysis.copy(infos = infos.reverse) -> errors
    }
  }
}
