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
    phoneCountryCode: "+1",

    address: {
      line1: "",
      city: "Tysons Corner",
      state: "Virginia",
      stateCode: "VA",
      postalCode: "",
      country: "United States",
      countryCode: "US"
    },
    currentLocation: "Tysons Corner, Virginia, USA",

    // Work eligibility — sensible defaults; review before submitting
    workAuthorization: {
      authorizedToWork: "Yes",
      requiresSponsorship: "Yes",
      gender: "",
      race: "",
      veteranStatus: "I am not a veteran",
      disabilityStatus: "I do not wish to answer"
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

    // Path is informational only; Chrome can't programmatically pick a local file
    // due to security restrictions. User must click the resume upload manually.
    resumePath: "resumes/nikhil_gaddam.pdf"
  };

  root.AutoApply = root.AutoApply || {};
  root.AutoApply.DEFAULT_PROFILE = DEFAULT_PROFILE;
})(typeof window !== "undefined" ? window : globalThis);
