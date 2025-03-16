// app.js - Main JavaScript for Clinical Trials Explorer v2

// State management
const appState = {
    currentPage: 1,
    pageSize: 20,
    totalResults: 0,
    totalPages: 0,
    currentSearchType: 'term',
    currentSearchTerm: '',
    pageToken: null,
    isLoading: false,
    logs: [],
    currentTab: 'basicSearch',
    activeCharts: {}
};

// DOM elements
const elements = {
    // Search elements
    searchInput: document.getElementById('searchInput'),
    searchTypeSelect: document.getElementById('searchType'),
    searchBtn: document.getElementById('searchBtn'),
    
    // Tab elements
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    
    // Filter elements
    toggleFiltersBtn: document.getElementById('toggleFiltersBtn'),
    filtersPanel: document.getElementById('filtersPanel'),
    phaseFilter: document.getElementById('phaseFilter'),
    statusFilter: document.getElementById('statusFilter'),
    fieldsFilter: document.getElementById('fieldsFilter'),
    pageSizeFilter: document.getElementById('pageSizeFilter'),
    countTotalFilter: document.getElementById('countTotalFilter'),
    sortFilter: document.getElementById('sortFilter'),
    hasResultsFilter: document.getElementById('hasResultsFilter'),
    
    // Advanced search elements
    advancedQueryInput: document.getElementById('advancedQueryInput'),
    exampleQueries: document.querySelectorAll('.example-query'),
    
    // Comparison elements
    compareCondition: document.getElementById('compareCondition'),
    compareIntervention: document.getElementById('compareIntervention'),
    comparePhase: document.getElementById('comparePhase'),
    compareStatus: document.getElementById('compareStatus'),
    generateComparisonBtn: document.getElementById('generateComparisonBtn'),
    comparisonChartSection: document.getElementById('comparisonChartSection'),
    comparisonChart: document.getElementById('comparisonChart'),
    
    // Patient outcome elements
    outcomeCondition: document.getElementById('outcomeCondition'),
    outcomeIntervention: document.getElementById('outcomeIntervention'),
    analyzeOutcomesBtn: document.getElementById('analyzeOutcomesBtn'),
    outcomeAnalysisSection: document.getElementById('outcomeAnalysisSection'),
    successRateStats: document.getElementById('successRateStats'),
    enrollmentChart: document.getElementById('enrollmentChart'),
    
    // Results elements
    resultsContainer: document.getElementById('resultsContainer'),
    resultsTableHeader: document.getElementById('resultsTableHeader'),
    resultsTableBody: document.getElementById('resultsTableBody'),
    resultStats: document.getElementById('resultStats'),
    
    // Pagination elements
    paginationContainer: document.getElementById('paginationContainer'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    paginationStart: document.getElementById('paginationStart'),
    paginationEnd: document.getElementById('paginationEnd'),
    paginationTotal: document.getElementById('paginationTotal'),
    currentPageEl: document.getElementById('currentPage'),
    totalPagesEl: document.getElementById('totalPages'),
    
    // Loading and messages
    loadingIndicator: document.getElementById('loadingIndicator'),
    noResultsMessage: document.getElementById('noResultsMessage'),
    
    // Study details
    studyDetailsSection: document.getElementById('studyDetailsSection'),
    studyDetailsContent: document.getElementById('studyDetailsContent'),
    closeStudyDetailsBtn: document.getElementById('closeStudyDetailsBtn'),
    
    // Statistics
    toggleStatsBtn: document.getElementById('toggleStatsBtn'),
    statisticsSection: document.getElementById('statisticsSection'),
    statusChart: document.getElementById('statusChart'),
    phaseChart: document.getElementById('phaseChart'),
    enrollmentDistChart: document.getElementById('enrollmentDistChart'),
    totalStudiesCount: document.getElementById('totalStudiesCount'),
    avgEnrollment: document.getElementById('avgEnrollment'),
    studiesWithResults: document.getElementById('studiesWithResults'),
    
    // Logs
    toggleLogsBtn: document.getElementById('toggleLogsBtn'),
    logsSection: document.getElementById('logsSection'),
    logsContainer: document.getElementById('logsContainer'),
    clearLogsBtn: document.getElementById('clearLogsBtn')
};

// Initialize the application
function initApp() {
    // Attach event listeners
    attachEventListeners();
    
    // Initialize filters
    updateFiltersFromState();
    
    // Check if we have a search term in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('query')) {
        elements.searchInput.value = urlParams.get('query');
        if (urlParams.has('type')) {
            elements.searchTypeSelect.value = urlParams.get('type');
            appState.currentSearchType = urlParams.get('type');
        }
        
        // Trigger search
        performSearch();
    }
    
    // Load initial statistics
    loadStatistics();
    
    console.log('Clinical Trials Explorer v2 initialized');
}

// Attach event listeners to DOM elements
function attachEventListeners() {
    // Search button click
    elements.searchBtn.addEventListener('click', performSearch);
    
    // Enter key in search input
    elements.searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    // Search type change
    elements.searchTypeSelect.addEventListener('change', () => {
        appState.currentSearchType = elements.searchTypeSelect.value;
        updatePlaceholder();
    });
    
    // Toggle filters
    elements.toggleFiltersBtn.addEventListener('click', () => {
        elements.filtersPanel.classList.toggle('hidden');
    });
    
    // Toggle statistics
    elements.toggleStatsBtn.addEventListener('click', () => {
        elements.statisticsSection.classList.toggle('hidden');
        if (!elements.statisticsSection.classList.contains('hidden') && !appState.activeCharts.status) {
            loadStatistics();
        }
    });
    
    // Toggle logs
    elements.toggleLogsBtn.addEventListener('click', () => {
        elements.logsSection.classList.toggle('hidden');
    });
    
    // Clear logs
    elements.clearLogsBtn.addEventListener('click', () => {
        elements.logsContainer.innerHTML = '<div class="text-gray-500 italic">Logs cleared.</div>';
        appState.logs = [];
    });
    
    // Tab switching
    elements.tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // Example query click
    elements.exampleQueries.forEach(query => {
        query.addEventListener('click', () => {
            elements.advancedQueryInput.value = query.textContent;
        });
    });
    
    // Generate comparison
    elements.generateComparisonBtn.addEventListener('click', generateComparison);
    
    // Analyze outcomes
    elements.analyzeOutcomesBtn.addEventListener('click', analyzeOutcomes);
    
    // Pagination
    elements.prevPageBtn.addEventListener('click', () => {
        if (appState.currentPage > 1) {
            appState.currentPage--;
            appState.pageToken = null; // Reset page token when going back
            performSearch(false);
        }
    });
    
    elements.nextPageBtn.addEventListener('click', () => {
        if (appState.pageToken || appState.currentPage < appState.totalPages) {
            appState.currentPage++;
            performSearch(false);
        }
    });
    
    // Fields filter change
    if (elements.fieldsFilter) {
        elements.fieldsFilter.addEventListener('change', () => {
            const selectedOptions = Array.from(elements.fieldsFilter.selectedOptions);
            const fieldsValues = selectedOptions.map(option => option.value);
            appState.currentFields = fieldsValues.join(',');
        });
    }
    
    // Page size change
    elements.pageSizeFilter.addEventListener('change', () => {
        appState.pageSize = parseInt(elements.pageSizeFilter.value);
        appState.currentPage = 1; // Reset to first page
        appState.pageToken = null; // Reset page token
    });
    
    // Close study details
    elements.closeStudyDetailsBtn.addEventListener('click', () => {
        elements.studyDetailsSection.classList.add('hidden');
        elements.resultsContainer.classList.remove('hidden');
    });
}

// Switch between tabs
function switchTab(tabId) {
    // Update active tab button
    elements.tabButtons.forEach(button => {
        if (button.getAttribute('data-tab') === tabId) {
            button.classList.add('tab-active');
        } else {
            button.classList.remove('tab-active');
        }
    });
    
    // Show the active tab content, hide the rest
    elements.tabContents.forEach(content => {
        if (content.id === tabId) {
            content.classList.remove('hidden');
        } else {
            content.classList.add('hidden');
        }
    });
    
    appState.currentTab = tabId;
}

// Update search input placeholder based on search type
function updatePlaceholder() {
    switch (appState.currentSearchType) {
        case 'cond':
            elements.searchInput.placeholder = 'Enter a medical condition (e.g., diabetes, cancer)';
            break;
        case 'intr':
            elements.searchInput.placeholder = 'Enter a drug or intervention (e.g., aspirin, surgery)';
            break;
        case 'spons':
            elements.searchInput.placeholder = 'Enter a sponsor or collaborator name';
            break;
        case 'locn':
            elements.searchInput.placeholder = 'Enter a location (e.g., Boston, France)';
            break;
        case 'id':
            elements.searchInput.placeholder = 'Enter an NCT ID (e.g., NCT04280705)';
            break;
        case 'patient':
            elements.searchInput.placeholder = 'Enter patient-related search terms';
            break;
        default:
            elements.searchInput.placeholder = 'Search by keyword, condition, drug...';
    }
}

// Update filters from application state
function updateFiltersFromState() {
    elements.pageSizeFilter.value = appState.pageSize;
    
    // Find and select the option that contains the current fields
    if (elements.fieldsFilter) {
        for (let i = 0; i < elements.fieldsFilter.options.length; i++) {
            if (elements.fieldsFilter.options[i].value === appState.currentFields) {
                elements.fieldsFilter.options[i].selected = true;
                break;
            }
        }
    }
}

// Main search function
function performSearch(resetPage = true) {
    const searchTerm = elements.searchInput.value.trim();
    
    if (!searchTerm && appState.currentSearchType !== 'term') {
        alert('Please enter a search term');
        return;
    }
    
    if (resetPage) {
        appState.currentPage = 1;
        appState.pageToken = null;
    }
    
    appState.currentSearchTerm = searchTerm;
    appState.isLoading = true;
    
    // Update URL with search parameters
    const searchParams = new URLSearchParams();
    searchParams.set('query', searchTerm);
    searchParams.set('type', appState.currentSearchType);
    window.history.replaceState({}, '', `${window.location.pathname}?${searchParams.toString()}`);
    
    // Show loading state
    elements.loadingIndicator.classList.remove('hidden');
    elements.noResultsMessage.classList.add('hidden');
    elements.resultsTableBody.innerHTML = '';
    elements.resultsContainer.classList.remove('hidden');
    elements.studyDetailsSection.classList.add('hidden');
    
    // Build parameters based on search type and filters
    let apiParams = new URLSearchParams();
    
    // Handle ID search differently (direct study lookup)
    if (appState.currentSearchType === 'id') {
        fetchStudyDetails(searchTerm);
        return;
    }
    
    // Add search parameters based on type
    if (searchTerm) {
        switch (appState.currentSearchType) {
            case 'cond':
                apiParams.append('condition', searchTerm);
                break;
            case 'intr':
                apiParams.append('intervention', searchTerm);
                break;
            case 'spons':
                apiParams.append('sponsor', searchTerm);
                break;
            case 'locn':
                apiParams.append('location', searchTerm);
                break;
            case 'patient':
                apiParams.append('patientData', searchTerm);
                break;
            default:
                apiParams.append('query', searchTerm);
        }
    }
    
    // Add pagination
    apiParams.append('page', appState.currentPage);
    apiParams.append('pageSize', appState.pageSize);
    
    // Add page token if we have one (for continuation)
    if (appState.pageToken) {
        apiParams.append('pageToken', appState.pageToken);
    }
    
    // Add fields if we're on the basic or advanced search tab
    if (appState.currentTab === 'basicSearch' || appState.currentTab === 'advancedSearch') {
        // Get selected fields
        if (elements.fieldsFilter && elements.fieldsFilter.selectedOptions.length > 0) {
            const selectedFields = Array.from(elements.fieldsFilter.selectedOptions)
                .map(option => option.value)
                .join(',');
            
            apiParams.append('fields', selectedFields);
        }
    }
    
    // Add filters from basic search
    if (appState.currentTab === 'basicSearch') {
        if (elements.phaseFilter.value) {
            apiParams.append('phase', elements.phaseFilter.value);
        }
        
        if (elements.statusFilter.value) {
            apiParams.append('status', elements.statusFilter.value);
        }
        
        if (elements.sortFilter.value) {
            apiParams.append('sort', elements.sortFilter.value);
        }
        
        if (elements.hasResultsFilter.value) {
            const advanced = `AREA[HasResults]${elements.hasResultsFilter.value}`;
            apiParams.append('advanced', advanced);
        }
        
        if (elements.countTotalFilter.checked) {
            apiParams.append('countTotal', 'true');
        }
    }
    
    // Add advanced query if we're on the advanced search tab
    if (appState.currentTab === 'advancedSearch' && elements.advancedQueryInput.value.trim()) {
        apiParams.append('advanced', elements.advancedQueryInput.value.trim());
    }
    
    // Make the API request
    const apiUrl = `/api/studies/search?${apiParams.toString()}`;
    
    // Log the request
    addLog(`Request: GET ${apiUrl}`);
    
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            appState.isLoading = false;
            elements.loadingIndicator.classList.add('hidden');
            
            // Log the response (limited for large responses)
            addLog(`Response: ${JSON.stringify(data).substring(0, 500)}... (truncated)`);
            
            if (!data.success) {
                throw new Error('API request was not successful');
            }
            
            // Display the results
            displaySearchResults(data);
        })
        .catch(error => {
            appState.isLoading = false;
            elements.loadingIndicator.classList.add('hidden');
            alert(`Error: ${error.message}`);
            addLog(`Error: ${error.message}`);
            console.error('Search error:', error);
            
            // Show no results message
            elements.noResultsMessage.classList.remove('hidden');
        });
}

// Display search results
function displaySearchResults(data) {
    if (!data.data.studies || data.data.studies.length === 0) {
        elements.noResultsMessage.classList.remove('hidden');
        return;
    }
    
    // Update app state with pagination info
    if (data.pagination) {
        appState.totalResults = data.pagination.totalCount || 0;
        appState.totalPages = data.pagination.totalPages || 1;
        appState.pageToken = data.pagination.nextPageToken || null;
        
        // Update result stats
        elements.resultStats.textContent = `Found ${data.pagination.totalCount.toLocaleString()} studies`;
        
        // Update pagination
        updatePagination(data.pagination);
    }
    
    const studies = data.data.studies;
    
    // Build table headers based on the first study's structure
    elements.resultsTableHeader.innerHTML = '';
    
    // Define a set of common fields to display
    const headerFields = [
        { key: 'nctId', display: 'NCT ID' },
        { key: 'briefTitle', display: 'Title' },
        { key: 'overallStatus', display: 'Status' },
        { key: 'phase', display: 'Phase' },
        { key: 'hasResults', display: 'Has Results' },
        { key: 'actions', display: 'Actions' }
    ];
    
    // Add headers
    headerFields.forEach(field => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = field.display;
        elements.resultsTableHeader.appendChild(th);
    });
    
    // Build table rows
    elements.resultsTableBody.innerHTML = '';
    
    studies.forEach(study => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50';
        
        // Extract data based on the study structure (adapt to API v2 format)
        const nctId = study.protocolSection?.identificationModule?.nctId || 'N/A';
        const briefTitle = study.protocolSection?.identificationModule?.briefTitle || 'N/A';
        const overallStatus = study.protocolSection?.statusModule?.overallStatus || 'N/A';
        const phase = getPhase(study) || 'N/A';
        const hasResults = study.hasResults ? 'Yes' : 'No';
        
        // Create cells
        const createCell = (content, className = '') => {
            const td = document.createElement('td');
            td.className = `px-6 py-4 whitespace-nowrap text-sm ${className}`;
            td.textContent = content;
            return td;
        };
        
        // Add cells for each field
        tr.appendChild(createCell(nctId, 'font-medium text-indigo-600'));
        tr.appendChild(createCell(briefTitle, 'text-gray-900'));
        tr.appendChild(createCell(overallStatus, 'text-gray-500'));
        tr.appendChild(createCell(phase, 'text-gray-500'));
        tr.appendChild(createCell(hasResults, hasResults === 'Yes' ? 'text-green-600' : 'text-gray-500'));
        
        // Add action cell
        const actionTd = document.createElement('td');
        actionTd.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium';
        
        const viewBtn = document.createElement('button');
        viewBtn.className = 'text-indigo-600 hover:text-indigo-900 mr-3';
        viewBtn.textContent = 'View Details';
        viewBtn.addEventListener('click', () => {
            fetchStudyDetails(nctId);
        });
        actionTd.appendChild(viewBtn);
        
        tr.appendChild(actionTd);
        elements.resultsTableBody.appendChild(tr);
    });
}

// Extract phase from study in new API format
function getPhase(study) {
    if (!study.protocolSection?.designModule?.phaseList?.phase) {
        return null;
    }
    
    const phases = study.protocolSection.designModule.phaseList.phase;
    if (Array.isArray(phases)) {
        return phases.join(', ');
    }
    return phases;
}

// Fetch full study details
function fetchStudyDetails(nctId) {
    if (!nctId) return;
    
    appState.isLoading = true;
    elements.loadingIndicator.classList.remove('hidden');
    
    const apiUrl = `/api/studies/${nctId}`;
    
    // Log the request
    addLog(`Request: GET ${apiUrl}`);
    
    fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            appState.isLoading = false;
            elements.loadingIndicator.classList.add('hidden');
            
            // Log the response (limited for large responses)
            addLog(`Response: ${JSON.stringify(data).substring(0, 500)}... (truncated)`);
            
            if (!data.success) {
                throw new Error('API request was not successful');
            }
            
            displayStudyDetails(data.data);
        })
        .catch(error => {
            appState.isLoading = false;
            elements.loadingIndicator.classList.add('hidden');
            alert(`Error: ${error.message}`);
            addLog(`Error: ${error.message}`);
            console.error('Fetch study details error:', error);
        });
}

// Display full study details
// function displayStudyDetails(study) {
//     elements.resultsContainer.classList.add('hidden');
//     elements.studyDetailsSection.classList.remove('hidden');
    
//     if (!study || !study.protocolSection) {
//         elements.studyDetailsContent.innerHTML = '<div class="text-red-500">Error: Study details not found.</div>';
//         return;
//     }
    
//     // Access specific modules directly from the v2 API structure
//     const identification = study.protocolSection.identificationModule || {};
//     const status = study.protocolSection.statusModule || {};
//     const design = study.protocolSection.designModule || {};
//     const description = study.protocolSection.descriptionModule || {};
//     const sponsors = study.protocolSection.sponsorCollaboratorsModule || {};
//     const conditions = study.protocolSection.conditionsModule || {};
//     const arms = study.protocolSection.armsInterventionsModule || {};
//     const eligibility = study.protocolSection.eligibilityModule || {};
//     const locations = study.protocolSection.contactsLocationsModule || {};
//     const outcomes = study.protocolSection.outcomesModule || {};
    
//     // Build the HTML content for study details
//     let html = `
//         <div class="mb-6">
//             <h3 class="text-2xl font-semibold mb-2">${identification.briefTitle || 'No Title Available'}</h3>
//             <p class="text-gray-600">${identification.nctId || 'No NCT ID'}</p>
//             ${study.hasResults ? '<span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">Has Results</span>' : ''}
//         </div>
        
//         <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
//             <div>
//                 <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Study Information</h4>
//                 <dl class="space-y-2">
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Status</dt>
//                         <dd class="mt-1">${status.overallStatus || 'Not Specified'}</dd>
//                     </div>
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Phase</dt>
//                         <dd class="mt-1">${getPhaseDisplay(design) || 'Not Specified'}</dd>
//                     </div>
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Study Type</dt>
//                         <dd class="mt-1">${design.studyType || 'Not Specified'}</dd>
//                     </div>
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Start Date</dt>
//                         <dd class="mt-1">${getDateDisplay(status.startDateStruct) || 'Not Specified'}</dd>
//                     </div>
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Completion Date</dt>
//                         <dd class="mt-1">${getDateDisplay(status.completionDateStruct) || 'Not Specified'}</dd>
//                     </div>
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Enrollment</dt>
//                         <dd class="mt-1">${getEnrollmentDisplay(design) || 'Not Specified'}</dd>
//                     </div>
//                 </dl>
//             </div>
            
//             <div>
//                 <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Sponsor & Collaborators</h4>
//                 <dl class="space-y-2">
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Lead Sponsor</dt>
//                         <dd class="mt-1">${sponsors.leadSponsor?.name || 'Not Specified'}</dd>
//                     </div>
//                     <div>
//                         <dt class="text-sm font-medium text-gray-500">Collaborators</dt>
//                         <dd class="mt-1">${getCollaborators(sponsors) || 'None'}</dd>
//                     </div>
//                 </dl>
//             </div>
//         </div>
        
//         <div class="mt-6">
//             <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Description</h4>
//             <div class="prose max-w-none">
//                 <p>${description.briefSummary || 'No summary available.'}</p>
                
//                 ${description.detailedDescription ? 
//                     `<h5 class="text-md font-medium mt-4 mb-2">Detailed Description</h5>
//                     <p>${description.detailedDescription}</p>` : ''}
//             </div>
//         </div>
        
//         <div class="mt-6">
//             <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Conditions & Interventions</h4>
            
//             <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
//                 <div>
//                     <h5 class="text-md font-medium mb-2">Conditions</h5>
//                     <ul class="list-disc list-inside space-y-1">
//                         ${getConditionsList(conditions) || '<li>None specified</li>'}
//                     </ul>
//                 </div>
                
//                 <div>
//                     <h5 class="text-md font-medium mb-2">Interventions</h5>
//                     <ul class="list-disc list-inside space-y-1">
//                         ${getInterventionsList(arms) || '<li>None specified</li>'}
//                     </ul>
//                 </div>
//             </div>
//         </div>
        
//         ${eligibility ? `
//         <div class="mt-6">
//             <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Eligibility</h4>
            
//             <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
//                 <div>
//                     <h5 class="text-md font-medium mb-2">Criteria</h5>
//                     <div class="text-sm whitespace-pre-line bg-gray-50 p-3 rounded">${eligibility.eligibilityCriteria || 'No criteria specified.'}</div>
//                 </div>
                
//                 <div>
//                     <h5 class="text-md font-medium mb-2">Demographics</h5>
//                     <dl class="space-y-2">
//                         <div>
//                             <dt class="text-sm font-medium text-gray-500">Gender</dt>
//                             <dd class="mt-1">${eligibility.sex || 'Not Specified'}</dd>
//                         </div>
//                         <div>
//                             <dt class="text-sm font-medium text-gray-500">Minimum Age</dt>
//                             <dd class="mt-1">${eligibility.minimumAge || 'Not Specified'}</dd>
//                         </div>
//                         <div>
//                             <dt class="text-sm font-medium text-gray-500">Maximum Age</dt>
//                             <dd class="mt-1">${eligibility.maximumAge || 'Not Specified'}</dd>
//                         </div>
//                         <div>
//                             <dt class="text-sm font-medium text-gray-500">Healthy Volunteers</dt>
//                             <dd class="mt-1">${eligibility.healthyVolunteers || 'Not Specified'}</dd>
//                         </div>
//                     </dl>
//                 </div>
//             </div>
//         </div>` : ''}
        
//         ${outcomes ? `
//         <div class="mt-6">
//             <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Outcome Measures</h4>
            
//             <div class="space-y-4">
//                 ${getOutcomesList(outcomes) || '<p>No outcome measures specified.</p>'}
//             </div>
//         </div>` : ''}
        
//         ${locations ? `
//         <div class="mt-6">
//             <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Locations</h4>
            
//             <div class="grid grid-cols-1 gap-4">
//                 ${getLocationsList(locations) || '<p>No locations specified.</p>'}
//             </div>
//         </div>` : ''}
        
//         <div class="mt-6">
//             <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">More Information</h4>
            
//             <div class="flex flex-col space-y-2">
//                 <a href="https://clinicaltrials.gov/study/${identification.nctId}" target="_blank" class="text-indigo-600 hover:text-indigo-800">
//                     View on ClinicalTrials.gov
//                 </a>
//             </div>
//         </div>
//     `;
    
//     elements.studyDetailsContent.innerHTML = html;
// }

function displayStudyDetails(study) {
    elements.resultsContainer.classList.add('hidden');
    elements.studyDetailsSection.classList.remove('hidden');
    
    // Clear previous charts
    Object.values(appState.activeCharts).forEach(chart => chart.destroy());
    appState.activeCharts = {};
    
    if (!study || !study.protocolSection) {
        elements.studyDetailsContent.innerHTML = '<div class="text-red-500">Error: Study details not found.</div>';
        return;
    }

   

    
    // Access specific modules directly from the v2 API structure
    const identification = study.protocolSection.identificationModule || {};
    const status = study.protocolSection.statusModule || {};
    const design = study.protocolSection.designModule || {};
    const description = study.protocolSection.descriptionModule || {};
    const sponsors = study.protocolSection.sponsorCollaboratorsModule || {};
    const conditions = study.protocolSection.conditionsModule || {};
    const arms = study.protocolSection.armsInterventionsModule || {};
    const eligibility = study.protocolSection.eligibilityModule || {};
    const locations = study.protocolSection.contactsLocationsModule || {};
    const outcomes = study.protocolSection.outcomesModule || {};
    const results = study.resultsSection || {}; // Assuming resultsSection contains outcome results
    
    // Build the HTML content for study details
    let html = `
        <div class="mb-6">
            <h3 class="text-2xl font-semibold mb-2">${identification.briefTitle || 'No Title Available'}</h3>
            <p class="text-gray-600">${identification.nctId || 'No NCT ID'}</p>
            ${study.hasResults ? '<span class="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium">Has Results</span>' : ''}
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Study Information</h4>
                <dl class="space-y-2">
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Status</dt>
                        <dd class="mt-1">${status.overallStatus || 'Not Specified'}</dd>
                    </div>
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Phase</dt>
                        <dd class="mt-1">${getPhaseDisplay(design) || 'Not Specified'}</dd>
                    </div>
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Study Type</dt>
                        <dd class="mt-1">${design.studyType || 'Not Specified'}</dd>
                    </div>
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Start Date</dt>
                        <dd class="mt-1">${getDateDisplay(status.startDateStruct) || 'Not Specified'}</dd>
                    </div>
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Completion Date</dt>
                        <dd class="mt-1">${getDateDisplay(status.completionDateStruct) || 'Not Specified'}</dd>
                    </div>
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Enrollment</dt>
                        <dd class="mt-1">${getEnrollmentDisplay(design) || 'Not Specified'}</dd>
                    </div>
                </dl>
            </div>
            
            <div>
                <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Sponsor & Collaborators</h4>
                <dl class="space-y-2">
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Lead Sponsor</dt>
                        <dd class="mt-1">${sponsors.leadSponsor?.name || 'Not Specified'}</dd>
                    </div>
                    <div>
                        <dt class="text-sm font-medium text-gray-500">Collaborators</dt>
                        <dd class="mt-1">${getCollaborators(sponsors) || 'None'}</dd>
                    </div>
                </dl>
            </div>
        </div>
        
        <div class="mt-6">
            <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Description</h4>
            <div class="prose max-w-none">
                <p>${description.briefSummary || 'No summary available.'}</p>
                
                ${description.detailedDescription ? 
                    `<h5 class="text-md font-medium mt-4 mb-2">Detailed Description</h5>
                    <p>${description.detailedDescription}</p>` : ''}
            </div>
        </div>
        
        <div class="mt-6">
            <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Conditions & Interventions</h4>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h5 class="text-md font-medium mb-2">Conditions</h5>
                    <ul class="list-disc list-inside space-y-1">
                        ${getConditionsList(conditions) || '<li>None specified</li>'}
                    </ul>
                </div>
                
                <div>
                    <h5 class="text-md font-medium mb-2">Interventions</h5>
                    <ul class="list-disc list-inside space-y-1">
                        ${getInterventionsList(arms) || '<li>None specified</li>'}
                    </ul>
                </div>
            </div>
        </div>
        
        ${eligibility ? `
        <div class="mt-6">
            <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Eligibility</h4>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h5 class="text-md font-medium mb-2">Criteria</h5>
                    <div class="text-sm whitespace-pre-line bg-gray-50 p-3 rounded">${eligibility.eligibilityCriteria || 'No criteria specified.'}</div>
                </div>
                
                <div>
                    <h5 class="text-md font-medium mb-2">Demographics</h5>
                    <dl class="space-y-2">
                        <div>
                            <dt class="text-sm font-medium text-gray-500">Gender</dt>
                            <dd class="mt-1">${eligibility.sex || 'Not Specified'}</dd>
                        </div>
                        <div>
                            <dt class="text-sm font-medium text-gray-500">Minimum Age</dt>
                            <dd class="mt-1">${eligibility.minimumAge || 'Not Specified'}</dd>
                        </div>
                        <div>
                            <dt class="text-sm font-medium text-gray-500">Maximum Age</dt>
                            <dd class="mt-1">${eligibility.maximumAge || 'Not Specified'}</dd>
                        </div>
                        <div>
                            <dt class="text-sm font-medium text-gray-500">Healthy Volunteers</dt>
                            <dd class="mt-1">${eligibility.healthyVolunteers || 'Not Specified'}</dd>
                        </div>
                    </dl>
                </div>
            </div>
        </div>` : ''}
        
        ${outcomes ? `
        <div class="mt-6">
            <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Outcome Measures</h4>
            <div class="space-y-4">
                ${getOutcomesList(outcomes) || '<p>No outcome measures specified.</p>'}
            </div>
        </div>` : ''}



            ${study.hasResults || (study.resultsSection && Object.keys(study.resultsSection).length > 0) ? `
                <div class="mt-6">
                    <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Study Results</h4>
                    <div class="space-y-6">
                        ${getResultsCharts(results, identification.nctId)}
                    </div>
                </div>` : ''}
        
        ${locations ? `
        <div class="mt-6">
            <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">Locations</h4>
            <div class="grid grid-cols-1 gap-4">
                ${getLocationsList(locations) || '<p>No locations specified.</p>'}
            </div>
        </div>` : ''}
        
        <div class="mt-6">
            <h4 class="text-lg font-medium mb-3 border-b border-gray-200 pb-2">More Information</h4>
            <div class="flex flex-col space-y-2">
                <a href="https://clinicaltrials.gov/study/${identification.nctId}" target="_blank" class="text-indigo-600 hover:text-indigo-800">
                    View on ClinicalTrials.gov
                </a>
            </div>
        </div>
    `;
    
    // elements.studyDetailsContent.innerHTML = html;
    
    // Initialize charts after HTML is inserted
// Update the chart initialization condition
// Use a slight delay or ensure DOM is ready
setTimeout(() => {
    elements.studyDetailsContent.innerHTML = html;
    if (study.hasResults || (study.resultsSection && Object.keys(study.resultsSection).length > 0)) {
        initializeOutcomeCharts(results);
    }
}, 0); // Zero timeout ensures it runs after current execution stack

// if (study.hasResults || (study.resultsSection && Object.keys(study.resultsSection).length > 0)) {
//     initializeOutcomeCharts(results);
// }
}

// Helper function to initialize outcome charts
// Update getResultsCharts to pass group info correctly
function getResultsCharts(results, nctId) {
    const outcomeMeasures = results.outcomeMeasuresModule?.outcomeMeasures || [];
    
    if (!outcomeMeasures.length) {
        return '<p>No numerical results available.</p>';
    }
    
    let html = '';
    const primaryOutcomes = outcomeMeasures.filter(om => om.type === 'PRIMARY');
    const secondaryOutcomes = outcomeMeasures.filter(om => om.type === 'SECONDARY');
    
    if (primaryOutcomes.length > 0) {
        html += `
            <div>
                <h5 class="text-md font-medium mb-2">Primary Outcome Results</h5>
                <canvas id="primaryOutcomesChart_${nctId}" height="250"></canvas>
            </div>
        `;
    }
    
    if (secondaryOutcomes.length > 0) {
        html += `
            <div>
                <h5 class="text-md font-medium mb-2">Secondary Outcome Results</h5>
                <canvas id="secondaryOutcomesChart_${nctId}" height="250"></canvas>
            </div>
        `;
    }
    
    return html;
}

// Helper function to create a chart for outcomes
function createOutcomeChart(canvas, outcomes, title) {
    const ctx = canvas.getContext('2d');
    
    if (!outcomes.length) {
        console.warn(`No outcomes provided for ${title} chart`);
        ctx.fillText('No data available', 10, 50);
        return;
    }
    
    const allGroups = outcomes[0]?.groups || [];
    const isMultiGroup = allGroups.length > 1;

    // Flatten measurements for single-group studies with multiple classes/categories
    const labels = [];
    const dataValues = [];
    
    if (isMultiGroup) {
        // Multi-group: Compare across groups
        const datasets = allGroups.map((group, index) => {
            const groupData = outcomes.map(outcome => {
                const measurement = outcome.classes?.[0]?.categories?.[0]?.measurements?.find(m => m.groupId === group.id);
                return measurement ? parseFloat(measurement.value) || 0 : 0;
            });
            return {
                label: group.title,
                data: groupData,
                backgroundColor: `rgba(${index === 0 ? '52, 152, 219' : '46, 204, 113'}, 0.7)`,
                borderColor: `rgba(${index === 0 ? '52, 152, 219' : '46, 204, 113'}, 1)`,
                borderWidth: 1
            };
        });
        labels.push(...outcomes.map(outcome => outcome.title || 'Unnamed Outcome'));
        var finalDatasets = datasets; // Use var to allow redeclaration
    } else {
        // Single-group: Flatten all measurements across classes/categories
        outcomes.forEach(outcome => {
            outcome.classes?.forEach(cls => {
                cls.categories?.forEach(cat => {
                    cat.measurements?.forEach(m => {
                        labels.push(`${outcome.title}${cls.title ? ` (${cls.title})` : ''}`);
                        dataValues.push(parseFloat(m.value) || 0);
                    });
                });
            });
        });
        var finalDatasets = [{
            label: title,
            data: dataValues,
            backgroundColor: 'rgba(52, 152, 219, 0.7)',
            borderColor: 'rgba(52, 152, 219, 1)',
            borderWidth: 1
        }];
    }

    const unit = outcomes[0]?.unitOfMeasure || 'Value';

    if (appState.activeCharts[canvas.id]) {
        appState.activeCharts[canvas.id].destroy();
    }

    appState.activeCharts[canvas.id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: finalDatasets
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: unit === 'percentage of participants' ? 'Percentage (%)' : 'Participants'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Outcome Measure'
                    }
                }
            },
            plugins: {
                legend: {
                    display: isMultiGroup,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const datasetLabel = context.dataset.label || '';
                            return `${datasetLabel}: ${value}${unit === 'percentage of participants' ? '%' : ''}`;
                        }
                    }
                }
            }
        }
    });
}

// Update initializeOutcomeCharts to pass outcomes correctly
function initializeOutcomeCharts(results, nctId) {
    const outcomeMeasures = results.outcomeMeasuresModule?.outcomeMeasures || [];
    console.log(`NCT${nctId} - Outcome Measures:`, outcomeMeasures);
    
    const primaryCanvas = document.getElementById(`primaryOutcomesChart_${nctId}`);
    if (primaryCanvas) {
        const primaryOutcomes = outcomeMeasures.filter(om => om.type === 'PRIMARY');
        console.log(`NCT${nctId} - Primary Outcomes:`, primaryOutcomes);
        if (primaryOutcomes.length === 0) {
            const ctx = primaryCanvas.getContext('2d');
            ctx.fillText('No primary outcomes available', 10, 50);
        } else {
            createOutcomeChart(primaryCanvas, primaryOutcomes, 'Primary Outcomes');
        }
    }
    
    const secondaryCanvas = document.getElementById(`secondaryOutcomesChart_${nctId}`);
    if (secondaryCanvas) {
        const secondaryOutcomes = outcomeMeasures.filter(om => om.type === 'SECONDARY');
        console.log(`NCT${nctId} - Secondary Outcomes:`, secondaryOutcomes);
        if (secondaryOutcomes.length === 0) {
            const ctx = secondaryCanvas.getContext('2d');
            ctx.fillText('No secondary outcomes available', 10, 50);
        } else {
            createOutcomeChart(secondaryCanvas, secondaryOutcomes, 'Secondary Outcomes');
        }
    }
}

// Helper function to create a chart for outcomes




// Helper functions for study details
function getPhaseDisplay(design) {
    if (!design.phaseList || !design.phaseList.phase) {
        return null;
    }
    
    const phases = design.phaseList.phase;
    if (Array.isArray(phases)) {
        return phases.join(', ');
    }
    return phases;
}

function getDateDisplay(dateStruct) {
    if (!dateStruct) return null;
    return dateStruct.date || null;
}

function getEnrollmentDisplay(design) {
    if (!design.enrollmentInfo) return null;
    
    const count = design.enrollmentInfo.count;
    const type = design.enrollmentInfo.type;
    
    if (!count) return null;
    
    return `${count.toLocaleString()} ${type ? `(${type})` : ''}`;
}

function getCollaborators(sponsors) {
    if (!sponsors.collaborators || sponsors.collaborators.length === 0) {
        return null;
    }
    
    return sponsors.collaborators.map(c => c.name).join(', ');
}

function getConditionsList(conditions) {
    if (!conditions || !conditions.conditions || conditions.conditions.length === 0) {
        return null;
    }
    
    return conditions.conditions.map(condition => `<li>${condition}</li>`).join('');
}

function getInterventionsList(arms) {
    if (!arms || !arms.interventions || arms.interventions.length === 0) {
        return null;
    }
    
    return arms.interventions.map(intervention => {
        return `<li><strong>${intervention.name}</strong> - ${intervention.type || ''}</li>`;
    }).join('');
}

function getOutcomesList(outcomes) {
    if (!outcomes.primaryOutcomes && !outcomes.secondaryOutcomes) {
        return null;
    }
    
    let html = '';
    
    // Primary outcomes
    if (outcomes.primaryOutcomes && outcomes.primaryOutcomes.length > 0) {
        html += '<h5 class="text-md font-medium mb-2">Primary Outcomes</h5>';
        html += '<ul class="space-y-2">';
        
        outcomes.primaryOutcomes.forEach(outcome => {
            html += `
                <li class="bg-gray-50 p-3 rounded">
                    <div class="font-medium">${outcome.measure}</div>
                    ${outcome.description ? `<div class="text-sm text-gray-600 mt-1">${outcome.description}</div>` : ''}
                    ${outcome.timeFrame ? `<div class="text-sm text-gray-500 mt-1">Time Frame: ${outcome.timeFrame}</div>` : ''}
                </li>
            `;
        });
        
        html += '</ul>';
    }
    
    // Secondary outcomes
    if (outcomes.secondaryOutcomes && outcomes.secondaryOutcomes.length > 0) {
        html += '<h5 class="text-md font-medium mb-2 mt-4">Secondary Outcomes</h5>';
        html += '<ul class="space-y-2">';
        
        outcomes.secondaryOutcomes.forEach(outcome => {
            html += `
                <li class="bg-gray-50 p-3 rounded">
                    <div class="font-medium">${outcome.measure}</div>
                    ${outcome.description ? `<div class="text-sm text-gray-600 mt-1">${outcome.description}</div>` : ''}
                    ${outcome.timeFrame ? `<div class="text-sm text-gray-500 mt-1">Time Frame: ${outcome.timeFrame}</div>` : ''}
                </li>
            `;
        });
        
        html += '</ul>';
    }
    
    return html;
}

function getLocationsList(locations) {
    if (!locations.locations || locations.locations.length === 0) {
        return null;
    }
    
    // Limit to first 10 locations to prevent overwhelming the UI
    const displayLocations = locations.locations.slice(0, 10);
    
    const html = displayLocations.map(location => {
        return `
            <div class="bg-gray-50 p-3 rounded">
                <p class="font-medium">${location.facility || 'Unnamed Facility'}</p>
                <p class="text-sm text-gray-600">
                    ${location.city || ''} 
                    ${location.state ? ', ' + location.state : ''} 
                    ${location.country ? ', ' + location.country : ''}
                </p>
                <p class="text-sm mt-1">${location.status || ''}</p>
            </div>
        `;
    }).join('');
    
    // Add "more locations" message if needed
    if (locations.locations.length > 10) {
        return html + `<div class="text-center text-gray-500 mt-2">And ${locations.locations.length - 10} more locations...</div>`;
    }
    
    return html;
}

// Update pagination UI
function updatePagination(pagination) {
    const start = ((pagination.currentPage - 1) * pagination.pageSize) + 1;
    const end = Math.min(start + pagination.pageSize - 1, pagination.totalCount || 0);
    
    elements.paginationStart.textContent = start.toLocaleString();
    elements.paginationEnd.textContent = end.toLocaleString();
    elements.paginationTotal.textContent = (pagination.totalCount || 0).toLocaleString();
    elements.currentPageEl.textContent = pagination.currentPage;
    elements.totalPagesEl.textContent = pagination.totalPages || 1;
    
    // Enable/disable pagination buttons
    elements.prevPageBtn.disabled = pagination.currentPage <= 1;
    elements.nextPageBtn.disabled = !pagination.hasNextPage;
    
    // Show pagination if we have results
    elements.paginationContainer.classList.toggle('hidden', (pagination.totalCount || 0) === 0);
}

// Add log entry
function addLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = document.createElement('div');
    logEntry.className = 'mb-2 pb-2 border-b border-gray-200';
    logEntry.innerHTML = `
        <div class="text-xs text-gray-500">${timestamp}</div>
        <div>${message}</div>
    `;
    
    // Clear "no logs" message if present
    if (elements.logsContainer.querySelector('.text-gray-500.italic')) {
        elements.logsContainer.innerHTML = '';
    }
    
    elements.logsContainer.appendChild(logEntry);
    
    // Scroll to bottom
    elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
    
    // Add to app state
    appState.logs.push({ timestamp, message });
    
    // Limit logs to last 100
    if (appState.logs.length > 100) {
        appState.logs.shift();
    }
}

// Load statistics for the statistics panel
function loadStatistics() {
    // Clear any existing charts
    if (appState.activeCharts.status) {
        appState.activeCharts.status.destroy();
    }
    if (appState.activeCharts.phase) {
        appState.activeCharts.phase.destroy();
    }
    if (appState.activeCharts.enrollment) {
        appState.activeCharts.enrollment.destroy();
    }
    
    // Fetch status distribution
    fetch('/api/stats/field-values?fields=OverallStatus&types=ENUM')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data.length > 0) {
                const statusData = data.data[0];
                createStatusChart(statusData);
            }
        })
        .catch(error => {
            console.error('Error fetching status statistics:', error);
        });
    
    // Fetch phase distribution
    fetch('/api/stats/field-values?fields=Phase&types=ENUM')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data.length > 0) {
                const phaseData = data.data[0];
                createPhaseChart(phaseData);
            }
        })
        .catch(error => {
            console.error('Error fetching phase statistics:', error);
        });
    
    // Fetch enrollment statistics
    fetch('/api/stats/field-values?fields=EnrollmentCount&types=INTEGER')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.data.length > 0) {
                const enrollmentData = data.data[0];
                createEnrollmentChart(enrollmentData);
            }
        })
        .catch(error => {
            console.error('Error fetching enrollment statistics:', error);
        });
    
    // Fetch overall stats
    fetch('/api/stats/sizes')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                updateOverallStats(data.data);
            }
        })
        .catch(error => {
            console.error('Error fetching overall statistics:', error);
        });
}

// Create chart for study status distribution
function createStatusChart(statusData) {
    const ctx = elements.statusChart.getContext('2d');
    
    // Sort by count (highest first)
    const sortedValues = [...statusData.topValues].sort((a, b) => b.studiesCount - a.studiesCount);
    
    const labels = sortedValues.map(item => item.value);
    const counts = sortedValues.map(item => item.studiesCount);
    
    // Define colors for different statuses
    const colors = [
        'rgba(52, 152, 219, 0.8)',  // Blue
        'rgba(46, 204, 113, 0.8)',  // Green
        'rgba(155, 89, 182, 0.8)',  // Purple
        'rgba(231, 76, 60, 0.8)',   // Red
        'rgba(243, 156, 18, 0.8)',  // Yellow
        'rgba(26, 188, 156, 0.8)',  // Turquoise
        'rgba(241, 196, 15, 0.8)',  // Yellow
        'rgba(230, 126, 34, 0.8)',  // Orange
        'rgba(149, 165, 166, 0.8)'  // Gray
    ];
    
    appState.activeCharts.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'right',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${context.label}: ${value.toLocaleString()} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Create chart for phase distribution
function createPhaseChart(phaseData) {
    const ctx = elements.phaseChart.getContext('2d');
    
    // Sort by count (highest first)
    const sortedValues = [...phaseData.topValues].sort((a, b) => b.studiesCount - a.studiesCount);
    
    const labels = sortedValues.map(item => item.value || 'Not Specified');
    const counts = sortedValues.map(item => item.studiesCount);
    
    // Define colors for different phases
    const colors = [
        'rgba(26, 188, 156, 0.8)',  // Turquoise
        'rgba(46, 204, 113, 0.8)',  // Green
        'rgba(52, 152, 219, 0.8)',  // Blue
        'rgba(155, 89, 182, 0.8)',  // Purple
        'rgba(231, 76, 60, 0.8)',   // Red
        'rgba(241, 196, 15, 0.8)',  // Yellow
        'rgba(230, 126, 34, 0.8)',  // Orange
        'rgba(149, 165, 166, 0.8)'  // Gray
    ];
    
    appState.activeCharts.phase = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'right',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${context.label}: ${value.toLocaleString()} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}



// Create chart for enrollment distribution
function createEnrollmentChart(enrollmentData) {
    const ctx = elements.enrollmentDistChart.getContext('2d');
    
    // For the v2 API format which doesn't have topValues
    console.log('Enrollment data:', enrollmentData);
    
    // Create distribution buckets based on the min, max and avg values
    const min = enrollmentData.min || 0;
    const max = enrollmentData.max || 10000;
    const avg = enrollmentData.avg || 100;
    
    // Create reasonable buckets based on the average
    const bucketSize = Math.ceil(avg / 2);
    const numBuckets = 6;
    
    const enrollmentBuckets = [];
    for (let i = 0; i < numBuckets; i++) {
        const minValue = i * bucketSize;
        const maxValue = (i === numBuckets - 1) ? max : (i + 1) * bucketSize - 1;
        const label = i === numBuckets - 1 ? 
            `${minValue}+` : 
            `${minValue}-${maxValue}`;
        
        enrollmentBuckets.push({
            label,
            min: minValue,
            max: maxValue,
            // Distribute based on normal distribution around avg
            count: Math.round(100 * Math.exp(-0.5 * Math.pow((minValue + maxValue) / 2 - avg, 2) / Math.pow(avg / 2, 2)))
        });
    }
    
    const labels = enrollmentBuckets.map(bucket => bucket.label);
    const counts = enrollmentBuckets.map(bucket => bucket.count);
    
    // Rest of the function stays the same
    appState.activeCharts.enrollment = new Chart(ctx, {
        // chart configuration remains the same
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Studies',
                data: counts,
                backgroundColor: 'rgba(52, 152, 219, 0.7)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Studies'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Enrollment Size'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Studies: ${context.raw.toLocaleString()}`;
                        }
                    }
                }
            }
        }
    });
}

// Update overall statistics
function updateOverallStats(data) {
    elements.totalStudiesCount.textContent = data.totalStudies.toLocaleString();
    
    // Calculate average enrollment (would come from API in real application)
    elements.avgEnrollment.textContent = "Loading...";
    
    // Fetch studies with results count
    fetch('/api/studies/search?advanced=AREA[HasResults]true&countTotal=true&pageSize=1')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.pagination) {
                elements.studiesWithResults.textContent = data.pagination.totalCount.toLocaleString();
            }
        })
        .catch(error => {
            console.error('Error fetching studies with results:', error);
            elements.studiesWithResults.textContent = "Error";
        });
}

// Generate comparison chart
function generateComparison() {
    const condition = elements.compareCondition.value.trim();
    const intervention = elements.compareIntervention.value.trim();
    const phase = elements.comparePhase.value;
    const status = elements.compareStatus.value;
    
    if (!condition && !intervention) {
        alert('Please enter at least a condition or intervention to compare');
        return;
    }
    
    // Show loading state
    elements.comparisonChartSection.classList.remove('hidden');
    
    // Build request parameters
    const params = new URLSearchParams();
    if (condition) params.append('condition', condition);
    if (intervention) params.append('intervention', intervention);
    if (phase) params.append('phase', phase);
    
    // Make API request
    fetch(`/api/analysis/success-rates?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                createComparisonChart(data.data);
            } else {
                throw new Error('API request was not successful');
            }
        })
        .catch(error => {
            alert(`Error generating comparison: ${error.message}`);
            console.error('Comparison error:', error);
        });
}

// Create comparison chart
function createComparisonChart(data) {
    const ctx = elements.comparisonChart.getContext('2d');
    
    // Clear any existing chart
    if (appState.activeCharts.comparison) {
        appState.activeCharts.comparison.destroy();
    }
    
    // Create chart data based on the overview
    const overview = data.overview;
    
    appState.activeCharts.comparison = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Total Completed Studies', 'Studies With Results'],
            datasets: [{
                label: 'Number of Studies',
                data: [overview.totalCompletedStudies, overview.totalWithResults],
                backgroundColor: [
                    'rgba(52, 152, 219, 0.7)',
                    'rgba(46, 204, 113, 0.7)'
                ],
                borderColor: [
                    'rgba(52, 152, 219, 1)',
                    'rgba(46, 204, 113, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Studies'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Studies: ${context.raw.toLocaleString()}`;
                        }
                    }
                }
            }
        }
    });
    
    // Add success rate text below the chart
    const successRateInfo = document.createElement('div');
    successRateInfo.className = 'text-center mt-4';
    successRateInfo.innerHTML = `
        <div class="text-lg font-medium">Success Rate: <span class="text-green-600">${overview.successRate}%</span></div>
        <div class="text-sm text-gray-600">
            ${overview.filter.condition ? `Condition: ${overview.filter.condition}` : ''}
            ${overview.filter.intervention ? `Intervention: ${overview.filter.intervention}` : ''}
            ${overview.filter.phase ? `Phase: ${overview.filter.phase}` : ''}
        </div>
    `;
    
    // Replace any existing info
    const existingInfo = elements.comparisonChartSection.querySelector('.text-center');
    if (existingInfo) {
        existingInfo.remove();
    }
    
    elements.comparisonChartSection.appendChild(successRateInfo);
}

// Analyze patient outcomes
function analyzeOutcomes() {
    const condition = elements.outcomeCondition.value.trim();
    const intervention = elements.outcomeIntervention.value.trim();
    
    if (!condition && !intervention) {
        alert('Please enter at least a condition or intervention to analyze');
        return;
    }
    
    // Show loading state
    elements.outcomeAnalysisSection.classList.remove('hidden');
    
    // Build request parameters
    const params = new URLSearchParams();
    if (condition) params.append('condition', condition);
    if (intervention) params.append('intervention', intervention);
    
    // Make API request
    fetch(`/api/analysis/success-rates?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayOutcomeAnalysis(data.data);
            } else {
                throw new Error('API request was not successful');
            }
        })
        .catch(error => {
            alert(`Error analyzing outcomes: ${error.message}`);
            console.error('Outcome analysis error:', error);
        });
}

// Display outcome analysis
function displayOutcomeAnalysis(data) {
    // Update success rate stats section
    const overview = data.overview;
    
    elements.successRateStats.innerHTML = `
        <div class="grid grid-cols-1 gap-3">
            <div>
                <div class="text-sm text-gray-500">Total Completed Studies</div>
                <div class="text-xl font-semibold">${overview.totalCompletedStudies.toLocaleString()}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">Studies With Results</div>
                <div class="text-xl font-semibold">${overview.totalWithResults.toLocaleString()}</div>
            </div>
            <div>
                <div class="text-sm text-gray-500">Success Rate</div>
                <div class="text-xl font-semibold text-green-600">${overview.successRate}%</div>
            </div>
            <div class="pt-2 border-t border-gray-200">
                <div class="text-sm text-gray-500">Filters Applied</div>
                <div class="text-sm">
                    ${overview.filter.condition ? `<div>Condition: ${overview.filter.condition}</div>` : ''}
                    ${overview.filter.intervention ? `<div>Intervention: ${overview.filter.intervention}</div>` : ''}
                </div>
            </div>
        </div>
    `;
    
    // Create enrollment distribution chart
    const ctx = elements.enrollmentChart.getContext('2d');
    
    // Clear any existing chart
    if (appState.activeCharts.enrollment) {
        appState.activeCharts.enrollment.destroy();
    }
    
    // Create enrollment distribution data
    // Note: In a real app, this would come from the API
    // Here we're creating sample data based on what's available
    const enrollmentStats = data.enrollmentStats;
    
    if (enrollmentStats && enrollmentStats.length > 0) {
        const topValues = enrollmentStats[0].topValues || [];
        
        // Sort by enrollment count and limit to top 10
        const sortedValues = [...topValues]
            .sort((a, b) => parseInt(a.value) - parseInt(b.value))
            .filter(item => !isNaN(parseInt(item.value)))
            .slice(0, 10);
        
        const labels = sortedValues.map(item => item.value);
        const counts = sortedValues.map(item => item.studiesCount);
        
        appState.activeCharts.enrollment = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Number of Studies',
                    data: counts,
                    backgroundColor: 'rgba(46, 204, 113, 0.7)',
                    borderColor: 'rgba(46, 204, 113, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Studies'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Enrollment Size'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Studies: ${context.raw.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);