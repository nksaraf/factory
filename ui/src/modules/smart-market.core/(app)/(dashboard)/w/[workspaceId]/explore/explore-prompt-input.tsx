"use client"

import {
  AudioWaveformIcon,
  CameraIcon,
  CheckIcon,
  FileIcon,
  GlobeIcon,
  ImageIcon,
  PaperclipIcon,
  ScreenShareIcon,
} from "lucide-react"
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
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@rio.js/agents-ui/components/ai-elements/prompt-input"
import {
  Suggestion,
  Suggestions,
} from "@rio.js/agents-ui/components/ai-elements/suggestion"
import { ButtonGroup } from "@rio.js/ui/button-group"
import { Button } from "@rio.js/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rio.js/ui/components/dropdown-menu"

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

const HeaderControls = () => {
  const controller = usePromptInputController()

  return (
    <header className="mt-8 flex items-center justify-between">
      <p className="text-sm">
        Header Controls via{" "}
        <code className="rounded-md bg-muted p-1 font-bold">
          PromptInputProvider
        </code>
      </p>
      <ButtonGroup>
        <Button
          onClick={() => {
            controller.textInput.clear()
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Clear input
        </Button>
        <Button
          onClick={() => {
            controller.textInput.setInput("Inserted via PromptInputProvider")
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Set input
        </Button>

        <Button
          onClick={() => {
            controller.attachments.clear()
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Clear attachments
        </Button>
      </ButtonGroup>
    </header>
  )
}

const suggestions = [
  "What are the best locations to open an ice cream store in New Delhi?",
  "Find gap areas in Gurgaon that are not covered by any McDonald's store",
]

const Example = ({
  onSubmit,
}: {
  onSubmit: (message: PromptInputMessage) => void
}) => {
  const [model, setModel] = useState<string>(models[0].id)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [status, setStatus] = useState<
    "submitted" | "streaming" | "ready" | "error"
  >("ready")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selectedModelData = models.find((m) => m.id === model)

  const handleSubmit = (message: PromptInputMessage) => {
    const hasText = Boolean(message.text)
    const hasAttachments = Boolean(message.files?.length)

    if (!(hasText || hasAttachments)) {
      return
    }

    setStatus("submitted")
    onSubmit(message)

    // eslint-disable-next-line no-console
    console.log("Submitting message:", message)

    setTimeout(() => {
      setStatus("streaming")
    }, SUBMITTING_TIMEOUT)

    setTimeout(() => {
      setStatus("ready")
    }, STREAMING_TIMEOUT)
  }

  return (
    <div className="flex max-w-xl w-full h-auto flex-col gap-4 pointer-events-auto">
      <div className="flex flex-col gap-2">
        <div className="text-3xl font-bold">Welcome back, Nikhil!</div>
        <div className="text-base text-muted-foreground">
          Curious about something in your business?
        </div>
      </div>
      <div className="shadow-lg w-full h-auto rounded-lg bg-white">
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
            {/* <PromptInputFooter>
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <PromptInputSpeechButton textareaRef={textareaRef} />
                <PromptInputButton icon={<GlobeIcon size={16} />}>
                  Search
                </PromptInputButton>
                <ModelSelector
                  onOpenChange={setModelSelectorOpen}
                  open={modelSelectorOpen}
                >
                  <ModelSelectorTrigger asChild>
                    <PromptInputButton
                      icon={
                        selectedModelData?.chefSlug && (
                          <ModelSelectorLogo
                            provider={selectedModelData.chefSlug}
                          />
                        )
                      }
                    >
                      {selectedModelData?.name && (
                        <ModelSelectorName>
                          {selectedModelData.name}
                        </ModelSelectorName>
                      )}
                    </PromptInputButton>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="Search models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                      {["OpenAI", "Anthropic", "Google"].map((chef) => (
                        <ModelSelectorGroup heading={chef} key={chef}>
                          {models
                            .filter((m) => m.chef === chef)
                            .map((m) => (
                              <ModelSelectorItem
                                key={m.id}
                                onSelect={() => {
                                  setModel(m.id)
                                  setModelSelectorOpen(false)
                                }}
                                value={m.id}
                              >
                                <ModelSelectorLogo provider={m.chefSlug} />
                                <ModelSelectorName>{m.name}</ModelSelectorName>
                                <ModelSelectorLogoGroup>
                                  {m.providers.map((provider) => (
                                    <ModelSelectorLogo
                                      key={provider}
                                      provider={provider}
                                    />
                                  ))}
                                </ModelSelectorLogoGroup>
                                {model === m.id ? (
                                  <CheckIcon className="ml-auto size-4" />
                                ) : (
                                  <div className="ml-auto size-4" />
                                )}
                              </ModelSelectorItem>
                            ))}
                        </ModelSelectorGroup>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              </PromptInputTools>
              <PromptInputSubmit status={status} />
            </PromptInputFooter> */}
            <PromptInputFooter className="p-2.5">
              <PromptInputTools>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <PromptInputButton
                      className="rounded-full border font-medium"
                      variant="outline"
                      icon={<PaperclipIcon size={16} />}
                    >
                      Attach
                    </PromptInputButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      icon={<FileIcon size={16} />}
                      onClick={() => handleFileAction("upload-file")}
                    >
                      Upload file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<ImageIcon size={16} />}
                      onClick={() => handleFileAction("upload-photo")}
                    >
                      Upload photo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<ScreenShareIcon size={16} />}
                      onClick={() => handleFileAction("take-screenshot")}
                    >
                      Take screenshot
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={<CameraIcon size={16} />}
                      onClick={() => handleFileAction("take-photo")}
                    >
                      Take photo
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <PromptInputButton
                  className="rounded-full border font-medium"
                  onClick={() => setUseWebSearch(!useWebSearch)}
                  variant="outline"
                  icon={<GlobeIcon size={16} />}
                >
                  Search
                </PromptInputButton>
              </PromptInputTools>
              <div className="flex flex-row gap-2">
                <PromptInputButton
                  className="rounded-full font-medium"
                  onClick={() => setUseMicrophone(!useMicrophone)}
                  variant="secondary"
                  icon={<AudioWaveformIcon size={16} />}
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

          {/* <HeaderControls /> */}
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

export default Example
