package xyz.introus.orbit;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public final class WebAddressTest {
    @Test public void resolvesHostsPortsAndPaths() {
        assertEquals("https://example.com/", WebAddress.resolve(" Example.COM ", WebAddress.SearchEngine.GOOGLE));
        assertEquals("https://example.com:8443/docs", WebAddress.resolve("example.com:8443/docs", WebAddress.SearchEngine.GOOGLE));
        assertEquals("http://127.0.0.1:8080/", WebAddress.resolve("127.0.0.1:8080", WebAddress.SearchEngine.GOOGLE));
        assertEquals("http://[::1]:8080/", WebAddress.resolve("[::1]:8080", WebAddress.SearchEngine.GOOGLE));
        assertEquals("https://xn--bcher-kva.de/%EC%84%9C%EC%9A%B8", WebAddress.resolve("bücher.de/서울", WebAddress.SearchEngine.GOOGLE));
        assertEquals("example.com:8443", WebAddress.displayHost("https://www.example.com:8443/path"));
    }

    @Test public void preservesEscapesAndSearchInput() {
        assertEquals("https://example.com/a%2Fb?q=a+b#c", WebAddress.normalize("https://EXAMPLE.COM/a%2Fb?q=a+b#c"));
        assertEquals("https://search.naver.com/search.naver?query=%EC%84%9C%EC%9A%B8+%EB%82%A8%EC%82%B0",
                WebAddress.resolve("서울 남산", WebAddress.SearchEngine.NAVER));
        assertEquals("https://duckduckgo.com/?q=javascript%3Aalert%281%29",
                WebAddress.resolve("javascript:alert(1)", WebAddress.SearchEngine.DUCKDUCKGO));
        assertNull(WebAddress.resolve("   ", WebAddress.SearchEngine.GOOGLE));
    }

    @Test public void rejectsNonWebSchemesAndAmbiguousAuthorities() {
        for (String invalid : new String[]{"file:///secret", "javascript:alert(1)", "intent://example.com",
                "https://good.example@evil.example", "https://example.com%40evil.com",
                "https://example.com\\@evil.com", "https:///example.com", "https://example.com:99999",
                "https://example.com:-1", "https://example.com:0", "https://a b.example"}) {
            assertNull(invalid, WebAddress.normalize(invalid));
        }
    }
}
