import { AssistantSection } from "./components/assistant-section"
import { AuditableSection } from "./components/auditable-section"
import { CustomerLogosSection } from "./components/customer-logos-section"
import { FAQsSection } from "./components/faqs-section"
import { FeaturesGrid } from "./components/features-grid"
import { Footer } from "./components/footer"
import { HeroSection } from "./components/hero-section"
import { IntegrationSection } from "./components/integration-section"
import { Navigation } from "./components/navigation"
import { SecuritySection } from "./components/security-section"
import { TestimonialSection } from "./components/testimonial-section"
import { VideoSection } from "./components/video-section"
import { WorkflowsSection } from "./components/workflows-section"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-scale-100">
      <Navigation />
      <HeroSection />
      <CustomerLogosSection />
      <VideoSection />
      <AssistantSection />
      <WorkflowsSection />
      <AuditableSection />
      <FeaturesGrid />
      <TestimonialSection />
      <IntegrationSection />
      <SecuritySection />
      <FAQsSection />
      <Footer />
    </div>
  )
}
