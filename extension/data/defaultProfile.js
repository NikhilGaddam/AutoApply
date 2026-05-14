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

    // Shared account credentials reused for Workday / Greenhouse / etc. when
    // they require sign-in or account creation before showing the form.
    // Stored in chrome.storage.sync — review/clear via the Options page.
    // Sign-in uses `email` + `password`. If sign-in fails the extension
    // falls back to Create Account using a +wdN Gmail alias so the real
    // inbox still receives all Workday emails.
    account: {
      email: "ngaddam.dev@gmail.com",
      password: "AutoApply@2026",
      passwordCreate: "AutoApply@2026"
    },

    address: {
      line1: "2110 Paul Edwin Ter",
      line2: "Apt 104",
      city: "Falls Church",
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
      twitter: ""
    },

    currentCompany: "Strategy (formerly MicroStrategy)",
    currentTitle: "Software Engineer 2 - Infrastructure",
    yearsOfExperience: "4",
    desiredSalary: "",
    noticePeriod: "2 weeks",

    // Common employer screening questions
    previouslyEmployed: "No",
    referredByEmployee: "No",
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
        description: "Designed a distributed multi-cloud orchestration platform on AWS, GCP, Azure managing 1000+ clusters."
      },
      {
        company: "Sprinklr",
        title: "Software Engineer",
        location: "Delhi, India",
        startDate: "2021-07",
        endDate: "2023-08",
        current: false,
        description: "Built backend for Conversational AI platform; optimized no-code workflows for Uber and Microsoft."
      }
    ],

    skills: [
      "Python", "Go", "C++", "Java", "TypeScript", "JavaScript", "Bash", "SQL",
      "Kubernetes", "Docker", "Terraform", "Helm", "Spring Boot", "gRPC", "GraphQL",
      "Elasticsearch", "Kafka", "Redis", "PostgreSQL", "LangChain", "AWS", "GCP", "Azure"
    ],

    // Path inside the extension package, resolved via chrome.runtime.getURL().
    // The DataTransfer trick lets us assign this to <input type="file">.
    resumeAsset: "assets/resume.pdf",
    resumeFileName: "nikhil_gaddam.pdf",
    resumeMimeType: "application/pdf"
  };

  root.AutoApply = root.AutoApply || {};
  root.AutoApply.DEFAULT_PROFILE = DEFAULT_PROFILE;
})(typeof window !== "undefined" ? window : globalThis);
