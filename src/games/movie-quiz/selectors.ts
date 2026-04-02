export const movieQuizSelectors = {
  cookieAcceptButtons: ['button:has-text("Accept")', 'button:has-text("Accepter")'],
  startButtons: ['button:has-text("Start")', 'button:has-text("Play")', 'button:has-text("Commencer")'],
  answerButtons: ["[data-answer]", ".answer-button", "button.answer", "[role='button'].answer"],
  scoreText: ["[data-score]", ".score", "#score", "[aria-label='score']"],
  streakText: ["[data-streak]", ".streak", "#streak", "[aria-label='streak']"],
  gameOverMarkers: [
    "[data-game-over]",
    "text=Game Over",
    "text=Partie terminée",
    "text=Fin de partie"
  ]
};
