import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@rio.js/ui/accordion"
import { cn } from "@rio.js/ui/lib/utils"

const faqs = [
  {
    question: "What is SmartMarket?",
    answer:
      "SmartMarket is a market intelligence platform that combines your enterprise data (sales, outlets, distribution) with 100+ location datasets (demographics, footfall, POIs, competition, infrastructure) to power expansion strategy, distribution optimization, and revenue prediction for FMCG, Retail, and QSR businesses.",
  },
  {
    question: "What data sources does SmartMarket use?",
    answer:
      "SmartMarket unifies over 100 location datasets including demographics and affluence data (100M+ records), 30M+ POIs across 300+ categories, real-time footfall at 150m grids, infrastructure data, mobility and transit patterns, real estate values, economic indicators, and customer reviews. All data is verified and regularly updated.",
  },
  {
    question: "How does site selection scoring work?",
    answer:
      "SmartMarket's AI engine scores potential locations using a Market Opportunity Score (MOS) that factors in demographics, footfall patterns, competitor density, accessibility, catchment overlap, and your own sales data. It also models cannibalization risk against your existing network and predicts revenue with confidence intervals.",
  },
  {
    question: "Can SmartMarket optimize my distribution network?",
    answer:
      "Yes. SmartMarket provides end-to-end distribution optimization including territory design, beat planning, route optimization, and field force assignment. The platform balances outlet coverage, travel efficiency, and workload equity to maximize your team's productivity.",
  },
  {
    question: "Does SmartMarket replace our existing CRM or ERP?",
    answer:
      "No. SmartMarket augments your existing systems—no rip-and-replace required. It integrates seamlessly with Salesforce, SAP, and other CRM/ERP/DMS platforms, enriching your enterprise data with location intelligence to unlock new insights.",
  },
  {
    question: "What industries does SmartMarket serve?",
    answer:
      "SmartMarket is purpose-built for three verticals: Distribution-led businesses (FMCG, beverages, consumer goods), Retail (chain stores, fashion, electronics), and QSR (quick-service restaurants, cafes, food chains). Each vertical has tailored scoring models and workflows.",
  },
  {
    question: "How does the AI Analyst work?",
    answer:
      "The SmartMarket AI Analyst lets you ask complex market questions in plain English—like 'Where should we open our next 5 stores in Bangalore?' It understands context, runs sophisticated analyses across all your data, and returns actionable recommendations with supporting evidence. No SQL or data science skills required.",
  },
  {
    question: "How quickly can we deploy SmartMarket?",
    answer:
      "SmartMarket can be deployed in as little as 2 weeks. The platform comes pre-loaded with location intelligence data, and integration with your enterprise systems typically takes 1-2 weeks depending on complexity. Contact our team for a demo and onboarding plan tailored to your needs.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Absolutely. SmartMarket uses enterprise-grade security with AES-256 encryption at rest, TLS 1.2/1.3 in transit, role-based access controls, and comprehensive audit logging. We are SOC 2 Type II and ISO 27001 compliant.",
  },
  {
    question: "What ROI can I expect?",
    answer:
      "Customers typically see 30-50% reduction in site selection cycle time, 15-25% improvement in field force productivity through optimized beats and routes, and significantly higher hit rates on new store openings. The platform pays for itself within the first quarter for most enterprises.",
  },
]

export function FAQsSection() {
  return (
    <section className="w-full bg-scale-100 py-24">
      <div className="container mx-auto px-6">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-12 text-center text-4xl font-bold text-scale-1200 lg:text-5xl">
            FAQs
          </h2>

          <Accordion type="single" collapsible className="w-full space-y-2">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="rounded-lg border border-scale-500 bg-scale-50 px-6"
              >
                <AccordionTrigger className="text-left font-semibold text-scale-1200 hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-scale-1000">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
