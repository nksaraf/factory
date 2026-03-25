"use client"

import { useRef, useState } from "react"

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@rio.js/agents-ui/components/ai-elements/model-selector"
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@rio.js/agents-ui/components/ai-elements/prompt-input"
import {
  Suggestion,
  Suggestions,
} from "@rio.js/agents-ui/components/ai-elements/suggestion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rio.js/ui/components/dropdown-menu"
import { Icon } from "@rio.js/ui/icon"

const models = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    chef: "OpenAI",
    chefSlug: "openai",
    providers: ["openai", "azure"],
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    chef: "OpenAI",
    chefSlug: "openai",
    providers: ["openai", "azure"],
  },
  {
    id: "claude-opus-4-20250514",
    name: "Claude 4 Opus",
    chef: "Anthropic",
    chefSlug: "anthropic",
    providers: ["anthropic", "azure", "google", "amazon-bedrock"],
  },
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude 4 Sonnet",
    chef: "Anthropic",
    chefSlug: "anthropic",
    providers: ["anthropic", "azure", "google", "amazon-bedrock"],
  },
  {
    id: "gemini-2.0-flash-exp",
    name: "Gemini 2.0 Flash",
    chef: "Google",
    chefSlug: "google",
    providers: ["google"],
  },
]

const SUBMITTING_TIMEOUT = 200
const STREAMING_TIMEOUT = 2000

const suggestions = [
  "What are the best locations to open an ice cream store in New Delhi?",
  "Find gap areas in Gurgaon that are not covered by any McDonald's store",
]

const ScoutPromptInput = ({
  onSubmit,
}: {
  onSubmit: (message: PromptInputMessage) => void
}) => {
  const [model, setModel] = useState<string>(models[0].id)
  const [status, setStatus] = useState<
    "submitted" | "streaming" | "ready" | "error"
  >("ready")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text)
    const hasAttachments = Boolean(message.files?.length)

    if (!(hasText || hasAttachments)) {
      return
    }

    setStatus("submitted")
    onSubmit(message)

    setTimeout(() => {
      setStatus("streaming")
    }, SUBMITTING_TIMEOUT)

    setTimeout(() => {
      setStatus("ready")
    }, STREAMING_TIMEOUT)
  }

  const handleFileAction = (action: string) => {
    // TODO: implement file actions
    console.log("File action:", action)
  }

  return (
    <div className="flex max-w-xl w-full h-auto flex-col gap-4 pointer-events-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Welcome back, Nikhil!</h1>
        <p className="text-base text-muted-foreground">
          Curious about something in your business?
        </p>
      </div>
      <div className="shadow-lg w-full h-auto rounded-lg bg-card">
        <PromptInputProvider>
          <PromptInput
            className="text-lg"
            globalDrop
            multiple
            onSubmit={handleSubmit}
          >
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
            <PromptInputBody>
              <PromptInputTextarea ref={textareaRef} />
            </PromptInputBody>
            <PromptInputFooter className="p-2.5">
              <PromptInputTools>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <PromptInputButton
                      className="rounded-full border font-medium"
                      variant="outline"
                      icon={
                        <Icon icon="icon-[ph--paperclip]" className="h-4 w-4" />
                      }
                    >
                      Attach
                    </PromptInputButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      icon={
                        <Icon
                          icon="icon-[ph--file-duotone]"
                          className="h-4 w-4"
                        />
                      }
                      onClick={() => handleFileAction("upload-file")}
                    >
                      Upload file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={
                        <Icon
                          icon="icon-[ph--image-duotone]"
                          className="h-4 w-4"
                        />
                      }
                      onClick={() => handleFileAction("upload-photo")}
                    >
                      Upload photo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={
                        <Icon
                          icon="icon-[ph--monitor-duotone]"
                          className="h-4 w-4"
                        />
                      }
                      onClick={() => handleFileAction("take-screenshot")}
                    >
                      Take screenshot
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={
                        <Icon
                          icon="icon-[ph--camera-duotone]"
                          className="h-4 w-4"
                        />
                      }
                      onClick={() => handleFileAction("take-photo")}
                    >
                      Take photo
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <PromptInputButton
                  className="rounded-full border font-medium"
                  variant="outline"
                  icon={
                    <Icon icon="icon-[ph--globe-duotone]" className="h-4 w-4" />
                  }
                >
                  Search
                </PromptInputButton>
              </PromptInputTools>
              <div className="flex flex-row gap-2">
                <PromptInputButton
                  className="rounded-full font-medium"
                  variant="secondary"
                  icon={
                    <Icon
                      icon="icon-[ph--waveform-duotone]"
                      className="h-4 w-4"
                    />
                  }
                >
                  Voice
                </PromptInputButton>
                <PromptInputSubmit
                  status={status}
                  className="rounded-full font-medium"
                />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
      </div>
      <div className="flex flex-row flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <Suggestion
            key={suggestion}
            onClick={() => {
              onSubmit({ text: suggestion, files: [] })
            }}
            suggestion={suggestion}
            className="bg-scale-100 shadow-md"
          >
            {suggestion}
          </Suggestion>
        ))}
      </div>
    </div>
  )
}

export default ScoutPromptInput
