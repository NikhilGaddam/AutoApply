// Default profile, sourced from resumes/nikhil_gaddam.pdf.
// Stored on first install into chrome.storage.sync. User can edit via Options page.
(function (root) {
  const DEFAULT_PROFILE = {
    firstName: "Nikhil",
    lastName: "Gaddam",
    fullName: "Nikhil Gaddam",
    preferredName: "Nikhil",
    pronouns: "He/him",

    email: "ngaddam.dev@gmail.com",
    phone: "+1 571-635-2506",
    phoneLocal: "571-635-2506",
    phoneCountryCode: "+1",
    phoneType: "Mobile",
    phoneExtension: "",

    defaultProfileLinkType: "LinkedIn",
    applicationSource: "",

    // Shared account credentials reused for Workday / Greenhouse / etc. when
    // they require sign-in or account creation before showing the form.
    // Stored in chrome.storage.sync — review/clear via the Options page.
    // Sign-in uses `email` + `password`. If sign-in fails the extension
    // falls back to Create Account using a +wdN Gmail alias so the real
    // inbox still receives all Workday emails.
    account: {
      email: "ngaddam.dev@gmail.com",
      // password is used for sign-in attempts. passwordCreate is used when
      // creating a new Workday account (must be ≥12 chars with complexity).
      // Both are set to the same strong value so sign-in works after creation.
      password: "AutoApply@2026",
      passwordCreate: "AutoApply@2026"
    },

    address: {
      line1: "2110 Paul Edwin Ter",
      line2: "Apt 104",
      city: "Falls Church",
      county: "Fairfax",
      state: "Virginia",
      stateCode: "VA",
      postalCode: "22043",
      country: "United States",
      countryCode: "US"
    },
    currentLocation: "Falls Church, Virginia, USA",

    // Work eligibility : sensible defaults; review before submitting
    workAuthorization: {
      authorizedToWork: "Yes",
      requiresSponsorship: "Yes"
    },

    // Demographics : used for EEO surveys. Defaults: Man, Asian, non-veteran.
    // Override these in the Options page if you prefer not to disclose.
    demographics: {
      gender: "Man",
      race: "Asian",
      ethnicity: "Not Hispanic or Latino",
      veteranStatus: "I am not a veteran",
      disabilityStatus: "No, I do not have a disability"
    },

    links: {
      linkedin: "https://linkedin.com/in/nikhil-gaddam",
      github: "https://github.com/nikhilgaddam",
      portfolio: "",
      website: "",
      facebook: "",
      twitter: ""
    },

    currentCompany: "Strategy (formerly MicroStrategy)",
    currentTitle: "Software Engineer 2 - Infrastructure",
    yearsOfExperience: "4",
    professionalSoftwareEngineeringExperience5Plus: "Yes",
    desiredSalary: "",
    noticePeriod: "2 weeks",

    // Common employer screening questions
    previouslyEmployed: "No",
    referredByEmployee: "No",
    relativesAtCompany: "No",
    over18: "Yes",

    education: [
      {
        school: "Virginia Tech",
        degree: "Master's Degree",
        fieldOfStudy: "Computer Science",
        startDate: "2023-08",
        endDate: "2024-12",
        gpa: ""
      },
      {
        school: "Indian Institute of Technology, Guwahati",
        degree: "Bachelor's Degree",
        fieldOfStudy: "Computer Engineering",
        startDate: "2017-07",
        endDate: "2021-07",
        gpa: ""
      }
    ],

    experience: [
      {
        company: "Strategy (formerly MicroStrategy)",
        title: "Software Engineer 2 - Infrastructure",
        location: "Tysons Corner, Virginia",
        startDate: "2025-01",
        endDate: "",
        current: true,
        description: "Designed a distributed multi-cloud orchestration platform on hyperscalers AWS, GCP, Azure, and an emerging AI-focused cloud to provision and manage 1000+ clusters, engineering zero-downtime infrastructure upgrades and extending the platform to support GPU-accelerated workloads via NVIDIA DGX Cloud integration for AI/ML model training. Built the instance-to-Kubernetes container migration engine using composite Halyard workflows that auto-provision tenant networks, clusters, and environments from backups with auto-computed cluster sizing from source instance specs and secondary VPC CIDR injection into existing customer networks, cutting migration time from 6 hours to 2 hours. Reduced cloud spend by $10 million annually by implementing adaptive autoscaling for GPU and CPU-intensive services, optimizing capacity for AI/ML training workloads and improving cost efficiency by 25%. Developed an AIOps Bot that ingests container logs and metrics to support finance and ML engineering teams with anomaly detection, alerting, and reports for AI model deployment infrastructure and $40B+ in digital assets."
      },
      {
        company: "Sprinklr",
        title: "Software Engineer",
        location: "Delhi, India",
        startDate: "2021-07",
        endDate: "2023-08",
        current: false,
        description: "Developed core backend components for Sprinklr's Conversational AI platform, leveraging large language models and unsupervised learning to automate intent discovery and improve natural language understanding. Optimized the no-code business process automation platform, improving workflow execution efficiency and cutting first-response times by 33% for Uber and Microsoft across high-volume customer operations. Built a series of REST APIs totaling 4 distinct interfaces for the Guided Workflows product; these enhancements are being utilized by over 15 teams, fostering collaboration and operational efficiency."
      }
    ],

    projects: [
      {
        name: "Archon",
        description: "Open-source contributor to a modular agentic operating system; refactored the tool-execution pipeline."
      },
      {
        name: "Agent Browser for AI Agents",
        description: "Contributed to a headless browser automation CLI for AI agents."
      }
    ],

    research: [
      {
        title: "Identifying Parking Demand Hotspots in Seattle",
        venue: "Urban Transitions 2024"
      }
    ],

    achievements: [
      "JEE AIR 122, top 0.08% among 1.18M candidates"
    ],

    skills: [
      "Python", "Go", "C++", "Java", "TypeScript", "JavaScript", "Bash", "SQL",
      "Kubernetes", "Docker", "Terraform", "Helm", "Spring Boot", "gRPC", "GraphQL",
      "Elasticsearch", "Kafka", "Redis", "PostgreSQL", "LangChain", "AWS", "GCP", "Azure", "CKAD"
    ],

    resumeSummary: "Nikhil Gaddam is a Software Engineer 2 - Infrastructure at Strategy (formerly MicroStrategy), with experience designing multi-cloud orchestration on AWS, GCP, and Azure for 1000+ clusters, Kubernetes migration automation, adaptive autoscaling, AIOps anomaly detection, RAG/LangChain search systems, predictive SQL caching, and Conversational AI backend systems. Education includes a Master's in Computer Science from Virginia Tech and a Bachelor of Technology in Computer Engineering from IIT Guwahati.",

    // Path inside the extension package, resolved via chrome.runtime.getURL().
    // The DataTransfer trick lets us assign this to <input type="file">.
    resumeAsset: "assets/resume.pdf",
    resumeFileName: "nikhil_gaddam.pdf",
    resumeMimeType: "application/pdf"
  };

  root.AutoApply = root.AutoApply || {};
  root.AutoApply.DEFAULT_PROFILE = DEFAULT_PROFILE;
})(typeof window !== "undefined" ? window : globalThis);
