import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env";

export type GeneratedStrategy = {
  name: string;
  theme: string;
  bot_goal: string;
  content_angle: string;
  hook_template: string;
  caption_style: string;
  target_clip_duration: number;
  platforms: ("tiktok" | "instagram")[];
};

export type GeneratedCaptions = {
  caption: string;
  hashtags: string[];
  first_comment: string;
};

function parseJsonObject<T>(text: string): T {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

export async function generateStrategyWithGemini(game: string): Promise<GeneratedStrategy> {
  if (!env.GEMINI_API_KEY) {
    return {
      name: `Viral — ${game}`,
      theme: "Compétition & fun",
      bot_goal: "Maximiser le score et la streak",
      content_angle: "Gameplay court et punchy",
      hook_template: "Tu peux faire mieux que ce run ?",
      caption_style: "punchy",
      target_clip_duration: 20,
      platforms: ["tiktok"]
    };
  }

  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Tu es un expert contenu viral TikTok/Instagram pour jeux web cinéma.
Génère une stratégie de contenu pour le jeu : "${game}".
Réponds UNIQUEMENT avec un JSON valide ayant exactement ces clés :
name, theme, bot_goal, content_angle, hook_template, caption_style (une parmi punchy, clean, suspense, quiz_challenge, movie_fans, beat_this),
target_clip_duration (nombre entier secondes entre 15 et 45),
platforms (tableau contenant tiktok et/ou instagram).`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonObject<GeneratedStrategy>(text);
}

export async function generateCaptionsWithGemini(input: {
  game: string;
  captionStyle: string;
  score: number;
  streak: number;
  duration: number;
  botGoal: string;
}): Promise<GeneratedCaptions> {
  if (!env.GEMINI_API_KEY) {
    return {
      caption: `${input.game} — ${input.score} pts, streak ${input.streak} 🔥`,
      hashtags: ["fyp", "gaming", "viral", "jeu", "cinema"],
      first_comment: "Ton record ? 👇"
    };
  }

  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `Tu es un expert contenu viral TikTok/Instagram.
Jeu: ${input.game}. Style de légende: ${input.captionStyle}.
Score ${input.score}, streak ${input.streak}, durée ${input.duration}s. Objectif bot: ${input.botGoal}.
Réponds UNIQUEMENT avec un JSON : {"caption": "...", "hashtags": ["5 hashtags sans #"], "first_comment": "..."}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonObject<GeneratedCaptions>(text);
}
