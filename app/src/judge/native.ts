/**
 * Tauri-native judge — invokes the Rust `judge_grade` command, which spawns the same
 * headless `claude -p … --model haiku` Clerk as the vite judge plugin (NO API key,
 * subscription CLI only). Fallback contract mirrors the plugin exactly: any spawn
 * error / timeout / unparseable output keeps a fair grade (deterministic stub) but
 * tells the player the Clerk was away.
 */
import type { JudgeVerdict } from '../game/contracts';
import { stubJudge, AWAY_LINE, type JudgeArgs } from './stub';
import { invokeNative } from '../bridge/native';

function isVerdictShape(v: unknown): v is JudgeVerdict {
  return (
    !!v &&
    typeof v === 'object' &&
    'verdict' in v &&
    ((v as JudgeVerdict).verdict === 'pass' ||
      (v as JudgeVerdict).verdict === 'partial' ||
      (v as JudgeVerdict).verdict === 'fail') &&
    typeof (v as JudgeVerdict).line === 'string'
  );
}

export async function nativeJudge(args: JudgeArgs): Promise<JudgeVerdict> {
  try {
    const v = await invokeNative<unknown>('judge_grade', {
      prompt: args.prompt,
      answer: args.answer,
      rubric: args.rubric,
    });
    if (isVerdictShape(v)) return v;
  } catch {
    // fall through to the away-from-desk fallback
  }
  return { ...stubJudge(args), line: AWAY_LINE };
}
