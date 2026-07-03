import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { CHATGPT_CODEX_BASE_URL, CHATGPT_DUMMY_API_KEY } from "./constants.js";
import { createChatGPTAuth } from "./auth.js";
import { createChatGPTCodexFetch } from "./fetch.js";
import type { ChatGPTAuthLike, ChatGPTProviderOptions } from "./types.js";

type ResponsesModelId = Parameters<OpenAIProvider["responses"]>[0];
type ResponsesLanguageModel = ReturnType<OpenAIProvider["responses"]>;

const REASONING_ENCRYPTED_CONTENT_INCLUDE = "reasoning.encrypted_content";

const STATELESS_REPLAY_MIDDLEWARE: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const openaiOptions = params.providerOptions?.openai ?? {};

    return {
      ...params,
      providerOptions: {
        ...params.providerOptions,
        openai: {
          ...openaiOptions,
          include: mergeOpenAIInclude(openaiOptions.include),
          store: false,
        },
      },
    };
  },
};

export interface ChatGPTProvider {
  (modelId: ResponsesModelId): ResponsesLanguageModel;
  responses(modelId: ResponsesModelId): ResponsesLanguageModel;
  readonly auth: ChatGPTAuthLike;
  readonly openai: OpenAIProvider;
}

export function createChatGPTProvider(options: ChatGPTProviderOptions = {}): ChatGPTProvider {
  const auth =
    options.auth ??
    createChatGPTAuth({
      tokenStore: options.tokenStore,
      fetch: options.fetch,
    });

  const openai = createOpenAI({
    name: "chatgpt",
    apiKey: CHATGPT_DUMMY_API_KEY,
    baseURL: options.baseURL ?? CHATGPT_CODEX_BASE_URL,
    fetch: createChatGPTCodexFetch({
      auth,
      fetch: options.fetch,
      promptCacheKey: options.promptCacheKey,
      transform: options.transform,
    }),
  });

  const responses = (modelId: ResponsesModelId) =>
    wrapLanguageModel({
      model: openai.responses(modelId),
      middleware: STATELESS_REPLAY_MIDDLEWARE,
    }) as ResponsesLanguageModel;
  const provider = ((modelId: ResponsesModelId) => responses(modelId)) as ChatGPTProvider;

  Object.defineProperties(provider, {
    responses: { value: responses, enumerable: true },
    auth: { value: auth, enumerable: true },
    openai: { value: openai, enumerable: true },
  });

  return provider;
}

export function createChatGPTModel(
  modelId: ResponsesModelId,
  options?: ChatGPTProviderOptions,
): ResponsesLanguageModel {
  return createChatGPTProvider(options)(modelId);
}

export const chatgpt = createChatGPTProvider();

function mergeOpenAIInclude(value: unknown): string[] {
  const include = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  if (include.includes(REASONING_ENCRYPTED_CONTENT_INCLUDE)) return include;
  return [...include, REASONING_ENCRYPTED_CONTENT_INCLUDE];
}
