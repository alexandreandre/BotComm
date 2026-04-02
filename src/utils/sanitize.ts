export function maskToken(token: string): string {
  if (token.length <= 8) {
    return "***";
  }
  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}

export function safeRunContext(input: {
  run_id: string;
  game: string;
  game_url: string;
  webhook_url: string;
  callback_token: string;
}): Record<string, string> {
  return {
    run_id: input.run_id,
    game: input.game,
    game_url: input.game_url,
    webhook_url: input.webhook_url,
    callback_token: maskToken(input.callback_token)
  };
}
